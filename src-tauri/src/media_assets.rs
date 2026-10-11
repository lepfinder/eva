//! Media Assets — 自用素材库（与「文件库」设计分离）
//!
//! 路径：userData/media-assets.db
//! 入库来源：PicList 钩子 / 手动 / Grok 等；Phase A 不做向量检索与稿件反查。

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const DB_FILENAME: &str = "media-assets.db";

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    pub filename: String,
    pub mime_type: String,
    pub media_kind: String,
    pub local_path: Option<String>,
    pub cdn_url: Option<String>,
    pub content_hash: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub file_size: Option<i64>,
    pub prompt: Option<String>,
    pub source: String,
    pub favorite: bool,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub tags: Vec<MediaTag>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTag {
    pub id: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestRequest {
    pub cdn_url: Option<String>,
    pub local_path: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub media_kind: Option<String>,
    pub content_hash: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub file_size: Option<i64>,
    pub prompt: Option<String>,
    pub source: Option<String>,
    pub favorite: Option<bool>,
    pub notes: Option<String>,
    /// 通用标签名
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub purpose_tags: Vec<String>,
    #[serde(default)]
    pub style_tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAssetRequest {
    pub filename: Option<String>,
    pub prompt: Option<String>,
    pub notes: Option<String>,
    pub favorite: Option<bool>,
    pub media_kind: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub purpose_tags: Option<Vec<String>>,
    #[serde(default)]
    pub style_tags: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetListResult {
    pub items: Vec<MediaAsset>,
    pub total: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub asset: MediaAsset,
    pub created: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteAssetResult {
    pub id: String,
    /// Whether a cloud DeleteObject was attempted and succeeded (or object already absent).
    pub cloud_deleted: bool,
    /// Whether a local_path file was removed from disk.
    pub local_file_deleted: bool,
}

pub struct MediaAssetsState {
    pub db_path: PathBuf,
    pub user_data_dir: PathBuf,
}

pub type SharedMediaAssetsState = Arc<Mutex<MediaAssetsState>>;

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn db_path(user_data: &Path) -> PathBuf {
    user_data.join(DB_FILENAME)
}

fn infer_media_kind(mime: &str, filename: &str) -> String {
    let m = mime.to_lowercase();
    let f = filename.to_lowercase();
    if m.starts_with("image/")
        || f.ends_with(".png")
        || f.ends_with(".jpg")
        || f.ends_with(".jpeg")
        || f.ends_with(".gif")
        || f.ends_with(".webp")
        || f.ends_with(".svg")
    {
        return "image".into();
    }
    if m.starts_with("video/")
        || f.ends_with(".mp4")
        || f.ends_with(".mov")
        || f.ends_with(".webm")
        || f.ends_with(".mkv")
    {
        return "video".into();
    }
    if m.starts_with("audio/")
        || f.ends_with(".mp3")
        || f.ends_with(".wav")
        || f.ends_with(".m4a")
        || f.ends_with(".aac")
        || f.ends_with(".flac")
    {
        return "audio".into();
    }
    "other".into()
}

fn filename_from_path_or_url(local: &Option<String>, cdn: &Option<String>) -> String {
    if let Some(p) = local {
        if let Some(name) = Path::new(p).file_name().and_then(|s| s.to_str()) {
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    if let Some(u) = cdn {
        if let Some(seg) = u.split('/').last() {
            let clean = seg.split('?').next().unwrap_or(seg);
            if !clean.is_empty() {
                return clean.to_string();
            }
        }
    }
    "untitled".into()
}

pub fn open_db(user_data: &Path) -> Result<Connection, String> {
    let path = db_path(user_data);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS assets (
            id            TEXT PRIMARY KEY,
            filename      TEXT NOT NULL DEFAULT '',
            mime_type     TEXT NOT NULL DEFAULT '',
            media_kind    TEXT NOT NULL DEFAULT 'image',
            local_path    TEXT,
            cdn_url       TEXT,
            content_hash  TEXT,
            width         INTEGER,
            height        INTEGER,
            duration_ms   INTEGER,
            file_size     INTEGER,
            prompt        TEXT,
            source        TEXT NOT NULL DEFAULT 'manual',
            favorite      INTEGER NOT NULL DEFAULT 0,
            notes         TEXT,
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(media_kind);
        CREATE INDEX IF NOT EXISTS idx_assets_favorite ON assets(favorite);
        CREATE INDEX IF NOT EXISTS idx_assets_cdn ON assets(cdn_url);
        CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(content_hash);

        CREATE TABLE IF NOT EXISTS tags (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL UNIQUE,
            kind        TEXT NOT NULL DEFAULT 'general',
            created_at  INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS asset_tags (
            asset_id TEXT NOT NULL,
            tag_id   TEXT NOT NULL,
            PRIMARY KEY (asset_id, tag_id),
            FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
            id UNINDEXED,
            filename,
            prompt,
            notes,
            tags
        );
        ",
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn init(app: &AppHandle) -> SharedMediaAssetsState {
    let data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| {
            dirs::data_dir()
                .map(|d| d.join("com.xiyangxie.eva"))
                .unwrap_or_else(|| PathBuf::from("./"))
        });
    let user_data = data_dir.join("userData");
    let _ = fs::create_dir_all(&user_data);
    let path = db_path(&user_data);

    match open_db(&user_data) {
        Ok(conn) => {
            if let Err(e) = init_schema(&conn) {
                log::error!("[MediaAssets] schema init failed: {}", e);
            } else {
                log::info!("[MediaAssets] DB ready at {}", path.display());
            }
        }
        Err(e) => log::error!("[MediaAssets] DB open failed: {}", e),
    }

    Arc::new(Mutex::new(MediaAssetsState {
        db_path: path,
        user_data_dir: user_data,
    }))
}

fn ensure_tag(conn: &Connection, name: &str, kind: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("empty tag".into());
    }
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM tags WHERE name = ?1",
            params![trimmed],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(id) = existing {
        // keep kind if still general and new kind is more specific
        if kind != "general" {
            let _ = conn.execute(
                "UPDATE tags SET kind = ?1 WHERE id = ?2 AND kind = 'general'",
                params![kind, id],
            );
        }
        return Ok(id);
    }
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tags (id, name, kind, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, trimmed, kind, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(id)
}

fn set_asset_tags(
    conn: &Connection,
    asset_id: &str,
    general: &[String],
    purpose: &[String],
    style: &[String],
) -> Result<(), String> {
    conn.execute("DELETE FROM asset_tags WHERE asset_id = ?1", params![asset_id])
        .map_err(|e| e.to_string())?;

    let mut all_names: Vec<(String, String)> = Vec::new();
    for t in purpose {
        all_names.push((t.clone(), "purpose".into()));
    }
    for t in style {
        all_names.push((t.clone(), "style".into()));
    }
    for t in general {
        all_names.push((t.clone(), "general".into()));
    }

    let mut fts_tags: Vec<String> = Vec::new();
    for (name, kind) in all_names {
        match ensure_tag(conn, &name, &kind) {
            Ok(tag_id) => {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?1, ?2)",
                    params![asset_id, tag_id],
                );
                fts_tags.push(name);
            }
            Err(_) => continue,
        }
    }

    // refresh FTS tags field
    let (filename, prompt, notes): (String, String, String) = conn
        .query_row(
            "SELECT filename, COALESCE(prompt,''), COALESCE(notes,'') FROM assets WHERE id = ?1",
            params![asset_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or_default();
    let _ = conn.execute("DELETE FROM assets_fts WHERE id = ?1", params![asset_id]);
    let _ = conn.execute(
        "INSERT INTO assets_fts (id, filename, prompt, notes, tags) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![asset_id, filename, prompt, notes, fts_tags.join(" ")],
    );
    Ok(())
}

fn load_tags(conn: &Connection, asset_id: &str) -> Vec<MediaTag> {
    let mut stmt = match conn.prepare(
        "SELECT t.id, t.name, t.kind FROM tags t
         INNER JOIN asset_tags at ON at.tag_id = t.id
         WHERE at.asset_id = ?1
         ORDER BY t.kind, t.name",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params![asset_id], |r| {
        Ok(MediaTag {
            id: r.get(0)?,
            name: r.get(1)?,
            kind: r.get(2)?,
        })
    })
    .map(|rows| rows.flatten().collect())
    .unwrap_or_default()
}

fn row_to_asset(conn: &Connection, r: &rusqlite::Row<'_>) -> Result<MediaAsset, rusqlite::Error> {
    let id: String = r.get(0)?;
    let favorite_i: i64 = r.get(13)?;
    Ok(MediaAsset {
        id: id.clone(),
        filename: r.get(1)?,
        mime_type: r.get(2)?,
        media_kind: r.get(3)?,
        local_path: r.get(4)?,
        cdn_url: r.get(5)?,
        content_hash: r.get(6)?,
        width: r.get(7)?,
        height: r.get(8)?,
        duration_ms: r.get(9)?,
        file_size: r.get(10)?,
        prompt: r.get(11)?,
        source: r.get(12)?,
        favorite: favorite_i != 0,
        notes: r.get(14)?,
        created_at: r.get(15)?,
        updated_at: r.get(16)?,
        tags: load_tags(conn, &id),
    })
}

const ASSET_SELECT: &str = "SELECT id, filename, mime_type, media_kind, local_path, cdn_url,
    content_hash, width, height, duration_ms, file_size, prompt, source, favorite, notes,
    created_at, updated_at FROM assets";

pub fn get_asset(user_data: &Path, id: &str) -> Result<Option<MediaAsset>, String> {
    let conn = open_db(user_data)?;
    init_schema(&conn)?;
    let mut stmt = conn
        .prepare(&format!("{} WHERE id = ?1", ASSET_SELECT))
        .map_err(|e| e.to_string())?;
    let asset = stmt
        .query_row(params![id], |r| row_to_asset(&conn, r))
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(asset)
}

pub fn list_assets(
    user_data: &Path,
    limit: i64,
    offset: i64,
    q: Option<&str>,
    media_kind: Option<&str>,
    favorite_only: bool,
    tag: Option<&str>,
) -> Result<AssetListResult, String> {
    let conn = open_db(user_data)?;
    init_schema(&conn)?;

    let mut where_parts: Vec<String> = Vec::new();
    let mut bind_vals: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if favorite_only {
        where_parts.push("a.favorite = 1".into());
    }
    if let Some(kind) = media_kind {
        if !kind.is_empty() && kind != "all" {
            where_parts.push(format!("a.media_kind = ?{}", bind_vals.len() + 1));
            bind_vals.push(Box::new(kind.to_string()));
        }
    }
    if let Some(t) = tag {
        if !t.is_empty() {
            where_parts.push(format!(
                "EXISTS (SELECT 1 FROM asset_tags at INNER JOIN tags tg ON tg.id = at.tag_id WHERE at.asset_id = a.id AND tg.name = ?{})",
                bind_vals.len() + 1
            ));
            bind_vals.push(Box::new(t.to_string()));
        }
    }

    let query = q.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let use_fts = query.as_ref().map(|s| !s.is_empty()).unwrap_or(false);

    let (from_sql, extra_where) = if use_fts {
        let qstr = query.unwrap();
        // Escape FTS special chars lightly: wrap as phrase if spaces
        let fts_q = if qstr.contains(' ') {
            format!("\"{}\"", qstr.replace('"', ""))
        } else {
            format!("{}*", qstr.replace('"', ""))
        };
        where_parts.push(format!("a.id IN (SELECT id FROM assets_fts WHERE assets_fts MATCH ?{})", bind_vals.len() + 1));
        bind_vals.push(Box::new(fts_q));
        ("assets a", where_parts)
    } else {
        ("assets a", where_parts)
    };

    let where_sql = if extra_where.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", extra_where.join(" AND "))
    };

    let count_sql = format!("SELECT COUNT(*) FROM {}{}", from_sql, where_sql);
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = bind_vals.iter().map(|b| b.as_ref()).collect();
    let total: i64 = conn
        .query_row(&count_sql, params_ref.as_slice(), |r| r.get(0))
        .unwrap_or(0);

    let list_sql = format!(
        "SELECT a.id, a.filename, a.mime_type, a.media_kind, a.local_path, a.cdn_url,
         a.content_hash, a.width, a.height, a.duration_ms, a.file_size, a.prompt, a.source, a.favorite, a.notes,
         a.created_at, a.updated_at
         FROM {}{} ORDER BY a.created_at DESC LIMIT ?{} OFFSET ?{}",
        from_sql,
        where_sql,
        bind_vals.len() + 1,
        bind_vals.len() + 2
    );

    let mut stmt = conn.prepare(&list_sql).map_err(|e| e.to_string())?;
    let mut all_params: Vec<&dyn rusqlite::types::ToSql> = bind_vals.iter().map(|b| b.as_ref()).collect();
    let lim = limit.max(1).min(200);
    let off = offset.max(0);
    all_params.push(&lim);
    all_params.push(&off);

    let rows = stmt
        .query_map(all_params.as_slice(), |r| row_to_asset(&conn, r))
        .map_err(|e| e.to_string())?;
    let items: Vec<MediaAsset> = rows.flatten().collect();

    Ok(AssetListResult { items, total })
}

pub fn ingest_asset(user_data: &Path, req: IngestRequest) -> Result<IngestResult, String> {
    let conn = open_db(user_data)?;
    init_schema(&conn)?;

    let cdn = req
        .cdn_url
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let hash = req
        .content_hash
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let local = req
        .local_path
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if cdn.is_none() && local.is_none() && hash.is_none() {
        return Err("cdnUrl, localPath or contentHash is required".into());
    }

    let existing_id: Option<String> = if let Some(ref url) = cdn {
        conn.query_row(
            "SELECT id FROM assets WHERE cdn_url = ?1 LIMIT 1",
            params![url],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        None
    };
    let existing_id = if existing_id.is_some() {
        existing_id
    } else if let Some(ref h) = hash {
        conn.query_row(
            "SELECT id FROM assets WHERE content_hash = ?1 LIMIT 1",
            params![h],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    } else {
        None
    };

    let filename = req
        .filename
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| filename_from_path_or_url(&local, &cdn));
    let mime = req.mime_type.clone().unwrap_or_default();
    let kind = req
        .media_kind
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| infer_media_kind(&mime, &filename));
    let source = req
        .source
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "manual".into());
    let ts = now_ms();

    let (id, created) = if let Some(eid) = existing_id {
        conn.execute(
            "UPDATE assets SET
                filename = COALESCE(NULLIF(?1, ''), filename),
                mime_type = COALESCE(NULLIF(?2, ''), mime_type),
                media_kind = COALESCE(NULLIF(?3, ''), media_kind),
                local_path = COALESCE(?4, local_path),
                cdn_url = COALESCE(?5, cdn_url),
                content_hash = COALESCE(?6, content_hash),
                width = COALESCE(?7, width),
                height = COALESCE(?8, height),
                duration_ms = COALESCE(?9, duration_ms),
                file_size = COALESCE(?10, file_size),
                prompt = COALESCE(?11, prompt),
                source = COALESCE(NULLIF(?12, ''), source),
                favorite = COALESCE(?13, favorite),
                notes = COALESCE(?14, notes),
                updated_at = ?15
             WHERE id = ?16",
            params![
                filename,
                mime,
                kind,
                local,
                cdn,
                hash,
                req.width,
                req.height,
                req.duration_ms,
                req.file_size,
                req.prompt,
                source,
                req.favorite.map(|b| if b { 1 } else { 0 }),
                req.notes,
                ts,
                eid,
            ],
        )
        .map_err(|e| e.to_string())?;
        (eid, false)
    } else {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO assets (
                id, filename, mime_type, media_kind, local_path, cdn_url, content_hash,
                width, height, duration_ms, file_size, prompt, source, favorite, notes,
                created_at, updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            params![
                id,
                filename,
                mime,
                kind,
                local,
                cdn,
                hash,
                req.width,
                req.height,
                req.duration_ms,
                req.file_size,
                req.prompt,
                source,
                if req.favorite.unwrap_or(false) { 1 } else { 0 },
                req.notes,
                ts,
                ts,
            ],
        )
        .map_err(|e| e.to_string())?;
        (id, true)
    };

    // Always merge tags on ingest when provided
    if !req.tags.is_empty() || !req.purpose_tags.is_empty() || !req.style_tags.is_empty() {
        // On update, merge with existing tag names
        let mut general = req.tags.clone();
        let purpose = req.purpose_tags.clone();
        let style = req.style_tags.clone();
        if !created {
            let existing = load_tags(&conn, &id);
            for t in existing {
                if t.kind == "general" && !general.iter().any(|x| x == &t.name) {
                    general.push(t.name);
                }
            }
        }
        set_asset_tags(&conn, &id, &general, &purpose, &style)?;
    } else if created {
        // seed FTS row
        let _ = conn.execute(
            "INSERT INTO assets_fts (id, filename, prompt, notes, tags) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, filename, req.prompt.clone().unwrap_or_default(), req.notes.clone().unwrap_or_default(), ""],
        );
    }

    let asset = get_asset(user_data, &id)?.ok_or_else(|| "asset missing after ingest".to_string())?;
    Ok(IngestResult { asset, created })
}

pub fn update_asset(
    user_data: &Path,
    id: &str,
    req: UpdateAssetRequest,
) -> Result<MediaAsset, String> {
    let conn = open_db(user_data)?;
    init_schema(&conn)?;

    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM assets WHERE id = ?1",
            params![id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if !exists {
        return Err("asset not found".into());
    }

    let ts = now_ms();
    conn.execute(
        "UPDATE assets SET
            filename = COALESCE(?1, filename),
            prompt = COALESCE(?2, prompt),
            notes = COALESCE(?3, notes),
            favorite = COALESCE(?4, favorite),
            media_kind = COALESCE(?5, media_kind),
            updated_at = ?6
         WHERE id = ?7",
        params![
            req.filename,
            req.prompt,
            req.notes,
            req.favorite.map(|b| if b { 1 } else { 0 }),
            req.media_kind,
            ts,
            id,
        ],
    )
    .map_err(|e| e.to_string())?;

    if req.tags.is_some() || req.purpose_tags.is_some() || req.style_tags.is_some() {
        let general = req.tags.unwrap_or_default();
        let purpose = req.purpose_tags.unwrap_or_default();
        let style = req.style_tags.unwrap_or_default();
        set_asset_tags(&conn, id, &general, &purpose, &style)?;
    } else {
        // refresh FTS text fields
        let (filename, prompt, notes): (String, String, String) = conn
            .query_row(
                "SELECT filename, COALESCE(prompt,''), COALESCE(notes,'') FROM assets WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or_default();
        let tag_names: String = load_tags(&conn, id)
            .into_iter()
            .map(|t| t.name)
            .collect::<Vec<_>>()
            .join(" ");
        let _ = conn.execute("DELETE FROM assets_fts WHERE id = ?1", params![id]);
        let _ = conn.execute(
            "INSERT INTO assets_fts (id, filename, prompt, notes, tags) VALUES (?1,?2,?3,?4,?5)",
            params![id, filename, prompt, notes, tag_names],
        );
    }

    get_asset(user_data, id)?.ok_or_else(|| "asset missing after update".into())
}

/// Delete an asset: cloud object first (if cdn_url), then DB row (+ FTS / tags) and optional local file.
/// If cloud delete fails, the local DB row is left untouched.
pub fn delete_asset(user_data: &Path, id: &str) -> Result<DeleteAssetResult, String> {
    let asset = get_asset(user_data, id)?.ok_or_else(|| format!("Asset not found: {}", id))?;

    let mut cloud_deleted = false;
    if let Some(ref url) = asset.cdn_url {
        let url = url.trim();
        if !url.is_empty() {
            crate::cdn::delete_public_url(user_data, url).map_err(|e| {
                format!("云端删除失败，本地记录未删除: {}", e)
            })?;
            cloud_deleted = true;
        }
    }

    let mut local_file_deleted = false;
    if let Some(ref p) = asset.local_path {
        let path = Path::new(p);
        if path.is_file() {
            match fs::remove_file(path) {
                Ok(()) => local_file_deleted = true,
                Err(e) => log::warn!("[MediaAssets] remove local file {} failed: {}", p, e),
            }
        }
    }

    let conn = open_db(user_data)?;
    let _ = conn.execute("DELETE FROM assets_fts WHERE id = ?1", params![id]);
    // asset_tags cascade via FK when foreign_keys=ON
    let n = conn
        .execute("DELETE FROM assets WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("Asset not found: {}", id));
    }

    Ok(DeleteAssetResult {
        id: id.to_string(),
        cloud_deleted,
        local_file_deleted,
    })
}

pub fn list_all_tags(user_data: &Path) -> Result<Vec<MediaTag>, String> {
    let conn = open_db(user_data)?;
    init_schema(&conn)?;
    let mut stmt = conn
        .prepare("SELECT id, name, kind FROM tags ORDER BY kind, name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MediaTag {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.flatten().collect())
}

// ──────────────────────────────────────────────────
// Tauri commands
// ──────────────────────────────────────────────────

#[tauri::command]
pub fn media_assets_list(
    state: State<SharedMediaAssetsState>,
    limit: Option<i64>,
    offset: Option<i64>,
    q: Option<String>,
    media_kind: Option<String>,
    favorite_only: Option<bool>,
    tag: Option<String>,
) -> Result<AssetListResult, String> {
    let user_data = {
        let g = state.lock().map_err(|e| e.to_string())?;
        g.user_data_dir.clone()
    };
    list_assets(
        &user_data,
        limit.unwrap_or(60),
        offset.unwrap_or(0),
        q.as_deref(),
        media_kind.as_deref(),
        favorite_only.unwrap_or(false),
        tag.as_deref(),
    )
}

#[tauri::command]
pub fn media_assets_get(
    state: State<SharedMediaAssetsState>,
    id: String,
) -> Result<Option<MediaAsset>, String> {
    let user_data = {
        let g = state.lock().map_err(|e| e.to_string())?;
        g.user_data_dir.clone()
    };
    get_asset(&user_data, &id)
}

#[tauri::command]
pub fn media_assets_ingest(
    state: State<SharedMediaAssetsState>,
    payload: IngestRequest,
) -> Result<IngestResult, String> {
    let user_data = {
        let g = state.lock().map_err(|e| e.to_string())?;
        g.user_data_dir.clone()
    };
    ingest_asset(&user_data, payload)
}

#[tauri::command]
pub fn media_assets_update(
    state: State<SharedMediaAssetsState>,
    id: String,
    payload: UpdateAssetRequest,
) -> Result<MediaAsset, String> {
    let user_data = {
        let g = state.lock().map_err(|e| e.to_string())?;
        g.user_data_dir.clone()
    };
    update_asset(&user_data, &id, payload)
}

#[tauri::command]
pub fn media_assets_list_tags(
    state: State<SharedMediaAssetsState>,
) -> Result<Vec<MediaTag>, String> {
    let user_data = {
        let g = state.lock().map_err(|e| e.to_string())?;
        g.user_data_dir.clone()
    };
    list_all_tags(&user_data)
}

#[tauri::command]
pub fn media_assets_delete(
    state: State<SharedMediaAssetsState>,
    id: String,
) -> Result<DeleteAssetResult, String> {
    let user_data = {
        let g = state.lock().map_err(|e| e.to_string())?;
        g.user_data_dir.clone()
    };
    delete_asset(&user_data, &id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    fn temp_user_data() -> PathBuf {
        let dir = env::temp_dir().join(format!("eva-media-assets-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn ingest_upsert_by_cdn_url() {
        let ud = temp_user_data();
        let r1 = ingest_asset(
            &ud,
            IngestRequest {
                cdn_url: Some("https://cdn.example.com/a.png".into()),
                local_path: None,
                filename: Some("a.png".into()),
                mime_type: Some("image/png".into()),
                media_kind: None,
                content_hash: Some("hash1".into()),
                width: Some(100),
                height: Some(80),
                duration_ms: None,
                file_size: Some(1234),
                prompt: Some("cat".into()),
                source: Some("piclist".into()),
                favorite: None,
                notes: None,
                tags: vec!["配图".into()],
                purpose_tags: vec![],
                style_tags: vec!["扁平".into()],
            },
        )
        .unwrap();
        assert!(r1.created);

        let r2 = ingest_asset(
            &ud,
            IngestRequest {
                cdn_url: Some("https://cdn.example.com/a.png".into()),
                local_path: Some("/tmp/a.png".into()),
                filename: None,
                mime_type: None,
                media_kind: None,
                content_hash: Some("hash1".into()),
                width: None,
                height: None,
                duration_ms: None,
                file_size: None,
                prompt: Some("cat v2".into()),
                source: Some("piclist".into()),
                favorite: Some(true),
                notes: None,
                tags: vec![],
                purpose_tags: vec![],
                style_tags: vec![],
            },
        )
        .unwrap();
        assert!(!r2.created);
        assert_eq!(r1.asset.id, r2.asset.id);
        assert_eq!(r2.asset.prompt.as_deref(), Some("cat v2"));
        assert!(r2.asset.favorite);

        let listed = list_assets(&ud, 10, 0, None, Some("image"), false, None).unwrap();
        assert_eq!(listed.total, 1);
        assert_eq!(listed.items[0].tags.len(), 2);

        let _ = fs::remove_dir_all(&ud);
    }

    #[test]
    fn delete_local_only_asset_no_cdn() {
        let ud = temp_user_data();
        let r = ingest_asset(
            &ud,
            IngestRequest {
                cdn_url: None,
                local_path: None,
                filename: Some("local-only.png".into()),
                mime_type: Some("image/png".into()),
                media_kind: Some("image".into()),
                content_hash: Some("testdeletehash001".into()),
                width: Some(1),
                height: Some(1),
                duration_ms: None,
                file_size: Some(12),
                prompt: None,
                source: Some("test".into()),
                favorite: None,
                notes: None,
                tags: vec![],
                purpose_tags: vec![],
                style_tags: vec![],
            },
        )
        .unwrap();
        assert!(r.created);
        let id = r.asset.id.clone();
        let del = delete_asset(&ud, &id).unwrap();
        assert_eq!(del.id, id);
        assert!(!del.cloud_deleted);
        assert!(get_asset(&ud, &id).unwrap().is_none());
        let _ = fs::remove_dir_all(&ud);
    }
}
