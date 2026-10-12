//! Media asset embeddings — Ollama EmbeddingGemma 2 for semantic search + coarse auto-tags.
//!
//! Vectors live in media-assets.db (`asset_embeddings`). Config: userData/media_embed_config.json.
//! Image caption VLM is stubbed in config for a later pass; search does not depend on it.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use reqwest::blocking::Client;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

use crate::media_assets::{
    ensure_tag, get_asset, init_schema, load_tags, open_db, MediaAsset,
};

const CONFIG_FILENAME: &str = "media_embed_config.json";
const EMBED_DIMS: usize = 768;
const QUERY_PREFIX: &str = "task: search result | query: ";

// ──────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEmbedConfig {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_base_url")]
    pub ollama_base_url: String,
    #[serde(default = "default_model")]
    pub model: String,
    /// When true, after indexing derive tags from nearest labeled neighbors.
    #[serde(default = "default_auto_tag")]
    pub auto_tag: bool,
    /// Stub for a future captioning VLM (e.g. qwen3-vl:8b). Not used in Phase 1.
    #[serde(default)]
    pub caption_model: String,
    #[serde(default)]
    pub caption_enabled: bool,
}

fn default_enabled() -> bool {
    true
}
fn default_base_url() -> String {
    "http://127.0.0.1:11434".into()
}
fn default_model() -> String {
    "embeddinggemma-2".into()
}
fn default_auto_tag() -> bool {
    true
}

impl Default for MediaEmbedConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            ollama_base_url: default_base_url(),
            model: default_model(),
            auto_tag: true,
            caption_model: String::new(),
            caption_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaEmbedConfigSave {
    pub enabled: Option<bool>,
    pub ollama_base_url: Option<String>,
    pub model: Option<String>,
    pub auto_tag: Option<bool>,
    pub caption_model: Option<String>,
    pub caption_enabled: Option<bool>,
}

fn config_path(user_data: &Path) -> PathBuf {
    user_data.join(CONFIG_FILENAME)
}

pub fn load_config(user_data: &Path) -> MediaEmbedConfig {
    let path = config_path(user_data);
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => MediaEmbedConfig::default(),
    }
}

fn save_config(user_data: &Path, cfg: &MediaEmbedConfig) -> Result<(), String> {
    if let Some(parent) = config_path(user_data).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let s = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(user_data), s).map_err(|e| e.to_string())
}

// ──────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────

pub struct MediaEmbedState {
    pub user_data_dir: PathBuf,
}

pub type SharedMediaEmbedState = Arc<Mutex<MediaEmbedState>>;

pub fn init(app: &AppHandle) -> SharedMediaEmbedState {
    let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
        dirs::data_dir()
            .map(|d| d.join("com.xiyangxie.eva"))
            .unwrap_or_else(|| PathBuf::from("./"))
    });
    let user_data = data_dir.join("userData");
    let _ = fs::create_dir_all(&user_data);
    // Ensure schema has embeddings table
    if let Ok(conn) = open_db(&user_data) {
        let _ = init_schema(&conn);
        let _ = ensure_embed_schema(&conn);
    }
    Arc::new(Mutex::new(MediaEmbedState {
        user_data_dir: user_data,
    }))
}

pub fn ensure_embed_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS asset_embeddings (
            asset_id     TEXT PRIMARY KEY,
            model        TEXT NOT NULL,
            dims         INTEGER NOT NULL,
            embedding    BLOB NOT NULL,
            indexed_at   INTEGER NOT NULL,
            status       TEXT NOT NULL DEFAULT 'ok',
            error_msg    TEXT,
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_asset_embeddings_status ON asset_embeddings(status);

        CREATE TABLE IF NOT EXISTS embed_queue (
            asset_id    TEXT PRIMARY KEY,
            enqueued_at INTEGER NOT NULL,
            attempts    INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
        );
        ",
    )
    .map_err(|e| e.to_string())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ──────────────────────────────────────────────────
// Vector helpers
// ──────────────────────────────────────────────────

fn f32_vec_to_bytes(v: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

fn l2_normalize(v: &mut [f32]) {
    let mut sum = 0.0f32;
    for x in v.iter() {
        sum += *x * *x;
    }
    let norm = sum.sqrt();
    if norm > 1e-12 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let mut dot = 0.0f32;
    for i in 0..n {
        dot += a[i] * b[i];
    }
    dot
}

// ──────────────────────────────────────────────────
// Ollama client
// ──────────────────────────────────────────────────

fn http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
struct EmbedResponse {
    embeddings: Vec<Vec<f32>>,
}

/// Embed text via Ollama /api/embed.
pub fn ollama_embed_text(cfg: &MediaEmbedConfig, text: &str) -> Result<Vec<f32>, String> {
    let client = http_client()?;
    let url = format!(
        "{}/api/embed",
        cfg.ollama_base_url.trim_end_matches('/')
    );
    let body = json!({
        "model": cfg.model,
        "input": text,
        "dimensions": EMBED_DIMS,
    });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| format!("ollama embed request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().unwrap_or_default();
        return Err(format!("ollama embed HTTP {status}: {t}"));
    }
    let parsed: EmbedResponse = resp
        .json()
        .map_err(|e| format!("ollama embed parse: {e}"))?;
    let mut vec = parsed
        .embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "ollama returned empty embeddings".to_string())?;
    if vec.len() > EMBED_DIMS {
        vec.truncate(EMBED_DIMS);
    }
    if vec.len() != EMBED_DIMS {
        return Err(format!(
            "unexpected embedding dims: got {}, want {}",
            vec.len(),
            EMBED_DIMS
        ));
    }
    l2_normalize(&mut vec);
    Ok(vec)
}

/// Try multimodal image embed. Ollama may accept `images` on /api/embed; if not, fall back to
/// a text descriptor from filename (weak) — caller should prefer real image paths.
pub fn ollama_embed_image(
    cfg: &MediaEmbedConfig,
    image_bytes: &[u8],
    _hint: &str,
) -> Result<Vec<f32>, String> {
    let client = http_client()?;
    let url = format!(
        "{}/api/embed",
        cfg.ollama_base_url.trim_end_matches('/')
    );
    let b64 = B64.encode(image_bytes);

    // Ollama multimodal embed: require <|image|> placeholder + images[] (empty input yields 0-dim).
    let body = json!({
        "model": cfg.model,
        "input": "<|image|>",
        "images": [b64],
        "dimensions": EMBED_DIMS,
    });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .map_err(|e| format!("ollama image embed request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let t = resp.text().unwrap_or_default();
        return Err(format!("ollama image embed HTTP {status}: {t}"));
    }
    let parsed: EmbedResponse = resp
        .json()
        .map_err(|e| format!("ollama image embed parse: {e}"))?;
    let mut vec = parsed
        .embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "ollama returned empty image embeddings".to_string())?;
    if vec.len() > EMBED_DIMS {
        vec.truncate(EMBED_DIMS);
    }
    if vec.len() != EMBED_DIMS {
        return Err(format!(
            "unexpected image embedding dims: got {}, want {}",
            vec.len(),
            EMBED_DIMS
        ));
    }
    l2_normalize(&mut vec);
    Ok(vec)
}

fn read_bytes_from_path(path: &Path) -> Result<Vec<u8>, String> {
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    let client = http_client()?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| format!("download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("download HTTP {}", resp.status()));
    }
    // Cap ~8MB for embed thumbs
    let bytes = resp.bytes().map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("image too large for embed (>8MB)".into());
    }
    Ok(bytes.to_vec())
}

fn shrink_image_jpeg(bytes: &[u8], max_side: u32) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let img = img.thumbnail(max_side, max_side);
    let mut out = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut out);
    img.write_to(&mut cursor, image::ImageFormat::Jpeg)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

// ──────────────────────────────────────────────────
// Queue / index
// ──────────────────────────────────────────────────

pub fn enqueue_asset(user_data: &Path, asset_id: &str) -> Result<(), String> {
    let conn = open_db(user_data)?;
    init_schema(&conn)?;
    ensure_embed_schema(&conn)?;
    conn.execute(
        "INSERT INTO embed_queue (asset_id, enqueued_at, attempts) VALUES (?1, ?2, 0)
         ON CONFLICT(asset_id) DO UPDATE SET enqueued_at = excluded.enqueued_at",
        params![asset_id, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn store_embedding(
    conn: &Connection,
    asset_id: &str,
    model: &str,
    vec: &[f32],
) -> Result<(), String> {
    let blob = f32_vec_to_bytes(vec);
    conn.execute(
        "INSERT INTO asset_embeddings (asset_id, model, dims, embedding, indexed_at, status, error_msg)
         VALUES (?1, ?2, ?3, ?4, ?5, 'ok', NULL)
         ON CONFLICT(asset_id) DO UPDATE SET
           model = excluded.model,
           dims = excluded.dims,
           embedding = excluded.embedding,
           indexed_at = excluded.indexed_at,
           status = 'ok',
           error_msg = NULL",
        params![asset_id, model, vec.len() as i64, blob, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    let _ = conn.execute("DELETE FROM embed_queue WHERE asset_id = ?1", params![asset_id]);
    Ok(())
}

fn store_embed_error(conn: &Connection, asset_id: &str, model: &str, err: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO asset_embeddings (asset_id, model, dims, embedding, indexed_at, status, error_msg)
         VALUES (?1, ?2, 0, X'', ?3, 'error', ?4)
         ON CONFLICT(asset_id) DO UPDATE SET
           status = 'error',
           error_msg = excluded.error_msg,
           indexed_at = excluded.indexed_at,
           model = excluded.model",
        params![asset_id, model, now_ms(), err],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE embed_queue SET attempts = attempts + 1 WHERE asset_id = ?1",
        params![asset_id],
    )
    .ok();
    Ok(())
}

/// Index one asset: prefer local image bytes → CDN download → text fallback (filename/prompt/tags).
pub fn index_asset(user_data: &Path, asset_id: &str) -> Result<IndexOneResult, String> {
    let cfg = load_config(user_data);
    if !cfg.enabled {
        return Err("media embed is disabled in settings".into());
    }
    let asset = get_asset(user_data, asset_id)?.ok_or_else(|| "asset not found".to_string())?;
    let started = Instant::now();

    let mut used_modality = "text".to_string();
    let vec = match embed_asset_vector(&cfg, &asset) {
        Ok((v, modality)) => {
            used_modality = modality;
            v
        }
        Err(e) => {
            let conn = open_db(user_data)?;
            ensure_embed_schema(&conn)?;
            store_embed_error(&conn, asset_id, &cfg.model, &e)?;
            return Ok(IndexOneResult {
                asset_id: asset_id.to_string(),
                ok: false,
                modality: "none".into(),
                elapsed_ms: started.elapsed().as_millis() as i64,
                tags_added: vec![],
                error: Some(e),
            });
        }
    };

    let conn = open_db(user_data)?;
    init_schema(&conn)?;
    ensure_embed_schema(&conn)?;
    store_embedding(&conn, asset_id, &cfg.model, &vec)?;

    let mut tags_added = Vec::new();
    if cfg.auto_tag {
        tags_added = auto_tag_from_neighbors(&conn, asset_id, &vec, 5)?;
    }

    Ok(IndexOneResult {
        asset_id: asset_id.to_string(),
        ok: true,
        modality: used_modality,
        elapsed_ms: started.elapsed().as_millis() as i64,
        tags_added,
        error: None,
    })
}

fn embed_asset_vector(
    cfg: &MediaEmbedConfig,
    asset: &MediaAsset,
) -> Result<(Vec<f32>, String), String> {
    let is_image = asset.media_kind == "image"
        || asset.mime_type.to_lowercase().starts_with("image/");

    if is_image {
        // 1) local_path
        if let Some(ref lp) = asset.local_path {
            let p = Path::new(lp);
            if p.is_file() {
                if let Ok(raw) = read_bytes_from_path(p) {
                    let jpeg = shrink_image_jpeg(&raw, 512).unwrap_or(raw);
                    if let Ok(v) = ollama_embed_image(cfg, &jpeg, &asset.filename) {
                        return Ok((v, "image".into()));
                    }
                }
            }
        }
        // 2) cdn_url download
        if let Some(ref url) = asset.cdn_url {
            if let Ok(raw) = download_bytes(url) {
                let jpeg = shrink_image_jpeg(&raw, 512).unwrap_or(raw);
                if let Ok(v) = ollama_embed_image(cfg, &jpeg, &asset.filename) {
                    return Ok((v, "image".into()));
                }
            }
        }
    }

    // Text fallback — still useful for search on prompts/filenames
    let tag_names: Vec<String> = asset.tags.iter().map(|t| t.name.clone()).collect();
    let text = format!(
        "title: none | text: {} {} {}",
        asset.filename,
        asset.prompt.clone().unwrap_or_default(),
        tag_names.join(" ")
    );
    let v = ollama_embed_text(cfg, text.trim())?;
    Ok((v, "text".into()))
}

fn auto_tag_from_neighbors(
    conn: &Connection,
    asset_id: &str,
    query: &[f32],
    k: usize,
) -> Result<Vec<String>, String> {
    // Skip if asset already has any tags
    let existing = load_tags(conn, asset_id);
    if !existing.is_empty() {
        return Ok(vec![]);
    }

    let mut stmt = conn
        .prepare(
            "SELECT asset_id, embedding FROM asset_embeddings WHERE status = 'ok' AND asset_id != ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![asset_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut scored: Vec<(String, f32)> = Vec::new();
    for row in rows.flatten() {
        let (id, blob) = row;
        let v = bytes_to_f32_vec(&blob);
        if v.len() != query.len() {
            continue;
        }
        scored.push((id, cosine(query, &v)));
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k.max(1));

    use std::collections::HashMap;
    let mut tag_votes: HashMap<String, f32> = HashMap::new();
    for (nid, score) in &scored {
        if *score < 0.35 {
            continue;
        }
        for t in load_tags(conn, nid) {
            if t.kind == "purpose" && t.name == "piclist" {
                continue;
            }
            *tag_votes.entry(t.name).or_insert(0.0) += score;
        }
    }
    let mut ranked: Vec<(String, f32)> = tag_votes.into_iter().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let picks: Vec<String> = ranked
        .into_iter()
        .take(5)
        .map(|(n, _)| n)
        .collect();
    if picks.is_empty() {
        return Ok(vec![]);
    }

    for name in &picks {
        if let Ok(tag_id) = ensure_tag(conn, name, "auto") {
            let _ = conn.execute(
                "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?1, ?2)",
                params![asset_id, tag_id],
            );
        }
    }
    // Refresh FTS tags
    let all_tags = load_tags(conn, asset_id);
    let tag_str = all_tags
        .iter()
        .map(|t| t.name.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let (filename, prompt, notes): (String, String, String) = conn
        .query_row(
            "SELECT filename, COALESCE(prompt,''), COALESCE(notes,'') FROM assets WHERE id = ?1",
            params![asset_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or_default();
    let _ = conn.execute("DELETE FROM assets_fts WHERE id = ?1", params![asset_id]);
    let _ = conn.execute(
        "INSERT INTO assets_fts (id, filename, prompt, notes, tags) VALUES (?1,?2,?3,?4,?5)",
        params![asset_id, filename, prompt, notes, tag_str],
    );

    Ok(picks)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexOneResult {
    pub asset_id: String,
    pub ok: bool,
    pub modality: String,
    pub elapsed_ms: i64,
    pub tags_added: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexBatchResult {
    pub processed: i64,
    pub succeeded: i64,
    pub failed: i64,
    pub remaining: i64,
    pub results: Vec<IndexOneResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedStats {
    pub total_assets: i64,
    pub indexed: i64,
    pub errors: i64,
    pub queued: i64,
    pub model: String,
    pub enabled: bool,
}

pub fn embed_stats(user_data: &Path) -> Result<EmbedStats, String> {
    let cfg = load_config(user_data);
    let conn = open_db(user_data)?;
    init_schema(&conn)?;
    ensure_embed_schema(&conn)?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
        .unwrap_or(0);
    let indexed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM asset_embeddings WHERE status = 'ok'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let errors: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM asset_embeddings WHERE status = 'error'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    let queued: i64 = conn
        .query_row("SELECT COUNT(*) FROM embed_queue", [], |r| r.get(0))
        .unwrap_or(0);
    Ok(EmbedStats {
        total_assets: total,
        indexed,
        errors,
        queued,
        model: cfg.model,
        enabled: cfg.enabled,
    })
}

/// Enqueue all assets missing a successful embedding.
pub fn enqueue_missing(user_data: &Path) -> Result<i64, String> {
    let conn = open_db(user_data)?;
    init_schema(&conn)?;
    ensure_embed_schema(&conn)?;
    let mut stmt = conn
        .prepare(
            "SELECT a.id FROM assets a
             LEFT JOIN asset_embeddings e ON e.asset_id = a.id AND e.status = 'ok'
             WHERE e.asset_id IS NULL",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    let n = ids.len() as i64;
    let ts = now_ms();
    for id in ids {
        let _ = conn.execute(
            "INSERT INTO embed_queue (asset_id, enqueued_at, attempts) VALUES (?1, ?2, 0)
             ON CONFLICT(asset_id) DO NOTHING",
            params![id, ts],
        );
    }
    Ok(n)
}

pub fn process_queue(user_data: &Path, limit: i64) -> Result<IndexBatchResult, String> {
    let cfg = load_config(user_data);
    if !cfg.enabled {
        return Err("media embed is disabled".into());
    }
    let conn = open_db(user_data)?;
    ensure_embed_schema(&conn)?;
    let lim = limit.max(1).min(50);
    let mut stmt = conn
        .prepare(
            "SELECT asset_id FROM embed_queue ORDER BY enqueued_at ASC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = stmt
        .query_map(params![lim], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);
    drop(conn);

    let mut results = Vec::new();
    let mut ok = 0i64;
    let mut fail = 0i64;
    for id in ids {
        match index_asset(user_data, &id) {
            Ok(r) => {
                if r.ok {
                    ok += 1;
                } else {
                    fail += 1;
                }
                results.push(r);
            }
            Err(e) => {
                fail += 1;
                results.push(IndexOneResult {
                    asset_id: id,
                    ok: false,
                    modality: "none".into(),
                    elapsed_ms: 0,
                    tags_added: vec![],
                    error: Some(e),
                });
            }
        }
    }
    let remaining = {
        let conn = open_db(user_data)?;
        conn.query_row("SELECT COUNT(*) FROM embed_queue", [], |r| r.get(0))
            .unwrap_or(0)
    };
    Ok(IndexBatchResult {
        processed: (ok + fail),
        succeeded: ok,
        failed: fail,
        remaining,
        results,
    })
}

// ──────────────────────────────────────────────────
// Semantic search
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticHit {
    pub asset: MediaAsset,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    pub items: Vec<SemanticHit>,
    pub total: i64,
    pub elapsed_ms: i64,
}

pub fn semantic_search(
    user_data: &Path,
    query: &str,
    limit: i64,
    media_kind: Option<&str>,
) -> Result<SemanticSearchResult, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("query is empty".into());
    }
    let cfg = load_config(user_data);
    if !cfg.enabled {
        return Err("media embed is disabled".into());
    }
    let started = Instant::now();
    let prefixed = format!("{}{}", QUERY_PREFIX, q);
    let qvec = ollama_embed_text(&cfg, &prefixed)?;

    let conn = open_db(user_data)?;
    init_schema(&conn)?;
    ensure_embed_schema(&conn)?;

    let mut stmt = conn
        .prepare(
            "SELECT e.asset_id, e.embedding, a.media_kind
             FROM asset_embeddings e
             INNER JOIN assets a ON a.id = e.asset_id
             WHERE e.status = 'ok'",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Vec<u8>>(1)?,
                r.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let kind_filter = media_kind
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "all");

    let mut scored: Vec<(String, f32)> = Vec::new();
    for row in rows.flatten() {
        let (id, blob, kind) = row;
        if let Some(ref k) = kind_filter {
            if &kind != k {
                continue;
            }
        }
        let v = bytes_to_f32_vec(&blob);
        if v.len() != qvec.len() {
            continue;
        }
        scored.push((id, cosine(&qvec, &v)));
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let total = scored.len() as i64;
    let lim = limit.max(1).min(100) as usize;
    scored.truncate(lim);

    let mut items = Vec::new();
    for (id, score) in scored {
        if let Ok(Some(asset)) = get_asset(user_data, &id) {
            items.push(SemanticHit { asset, score });
        }
    }

    Ok(SemanticSearchResult {
        items,
        total,
        elapsed_ms: started.elapsed().as_millis() as i64,
    })
}

pub fn test_ollama(user_data: &Path) -> Result<Value, String> {
    let cfg = load_config(user_data);
    let started = Instant::now();
    let vec = ollama_embed_text(&cfg, "ping semantic search")?;
    Ok(json!({
        "ok": true,
        "model": cfg.model,
        "baseUrl": cfg.ollama_base_url,
        "dims": vec.len(),
        "elapsedMs": started.elapsed().as_millis() as i64,
    }))
}

// ──────────────────────────────────────────────────
// Tauri commands
// ──────────────────────────────────────────────────

fn user_data_from_embed(state: &State<SharedMediaEmbedState>) -> Result<PathBuf, String> {
    let g = state.lock().map_err(|e| e.to_string())?;
    Ok(g.user_data_dir.clone())
}


#[tauri::command]
pub fn media_embed_get_config(
    state: State<SharedMediaEmbedState>,
) -> Result<MediaEmbedConfig, String> {
    let ud = user_data_from_embed(&state)?;
    Ok(load_config(&ud))
}

#[tauri::command]
pub fn media_embed_save_config(
    state: State<SharedMediaEmbedState>,
    config: MediaEmbedConfigSave,
) -> Result<MediaEmbedConfig, String> {
    let ud = user_data_from_embed(&state)?;
    let mut cfg = load_config(&ud);
    if let Some(v) = config.enabled {
        cfg.enabled = v;
    }
    if let Some(v) = config.ollama_base_url {
        let t = v.trim().to_string();
        if !t.is_empty() {
            cfg.ollama_base_url = t;
        }
    }
    if let Some(v) = config.model {
        let t = v.trim().to_string();
        if !t.is_empty() {
            cfg.model = t;
        }
    }
    if let Some(v) = config.auto_tag {
        cfg.auto_tag = v;
    }
    if let Some(v) = config.caption_model {
        cfg.caption_model = v;
    }
    if let Some(v) = config.caption_enabled {
        cfg.caption_enabled = v;
    }
    save_config(&ud, &cfg)?;
    Ok(cfg)
}

#[tauri::command]
pub fn media_embed_test(state: State<SharedMediaEmbedState>) -> Result<Value, String> {
    let ud = user_data_from_embed(&state)?;
    test_ollama(&ud)
}

#[tauri::command]
pub fn media_embed_stats(state: State<SharedMediaEmbedState>) -> Result<EmbedStats, String> {
    let ud = user_data_from_embed(&state)?;
    embed_stats(&ud)
}

#[tauri::command]
pub fn media_embed_enqueue_missing(
    state: State<SharedMediaEmbedState>,
) -> Result<i64, String> {
    let ud = user_data_from_embed(&state)?;
    enqueue_missing(&ud)
}

#[tauri::command]
pub fn media_embed_process_queue(
    state: State<SharedMediaEmbedState>,
    limit: Option<i64>,
) -> Result<IndexBatchResult, String> {
    let ud = user_data_from_embed(&state)?;
    process_queue(&ud, limit.unwrap_or(8))
}

#[tauri::command]
pub fn media_embed_index_one(
    state: State<SharedMediaEmbedState>,
    asset_id: String,
) -> Result<IndexOneResult, String> {
    let ud = user_data_from_embed(&state)?;
    index_asset(&ud, &asset_id)
}

#[tauri::command]
pub fn media_embed_semantic_search(
    state: State<SharedMediaEmbedState>,
    query: String,
    limit: Option<i64>,
    media_kind: Option<String>,
) -> Result<SemanticSearchResult, String> {
    let ud = user_data_from_embed(&state)?;
    semantic_search(
        &ud,
        &query,
        limit.unwrap_or(60),
        media_kind.as_deref(),
    )
}

/// Called after ingest — enqueue then index one asset on a background thread.
pub fn enqueue_after_ingest(user_data: &Path, asset_id: &str) {
    if let Err(e) = enqueue_asset(user_data, asset_id) {
        log::warn!("[MediaEmbed] enqueue after ingest failed: {}", e);
        return;
    }
    let ud = user_data.to_path_buf();
    let id = asset_id.to_string();
    std::thread::spawn(move || {
        match index_asset(&ud, &id) {
            Ok(r) if r.ok => log::info!(
                "[MediaEmbed] indexed {} via {} in {}ms",
                id,
                r.modality,
                r.elapsed_ms
            ),
            Ok(r) => log::warn!(
                "[MediaEmbed] index {} failed: {:?}",
                id,
                r.error
            ),
            Err(e) => log::warn!("[MediaEmbed] index {} error: {}", id, e),
        }
    });
}

// Re-export helpers used by media_assets if needed — keep ensure_tag/load_tags accessible.
// media_assets must expose ensure_tag + load_tags as pub(crate) or pub.
