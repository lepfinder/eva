use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: serde_json::Value,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    /// Caller label for the history table, e.g. "ocr".
    #[serde(default)]
    pub source: Option<String>,
    /// sha256 of the source clipboard image, set by the OCR flow.
    #[serde(default)]
    pub image_hash: Option<String>,
    /// Qwen3-family hybrid thinking switch; only injected into the payload when set.
    #[serde(default)]
    pub enable_thinking: Option<bool>,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiListModelsRequest {
    pub base_url: String,
    pub api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCallRecord {
    pub id: i64,
    pub created_at: i64,
    pub source: String,
    pub model: String,
    pub status: String,
    pub error_msg: String,
    pub req_bytes: i64,
    pub image_bytes: i64,
    pub elapsed_ms: i64,
    pub prompt: String,
    pub response: String,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub image_hash: String,
}

const MAX_RECORDS: i64 = 2000;

fn open_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("userData");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("ai-history.db")).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS ai_calls (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at        INTEGER NOT NULL,
            source            TEXT NOT NULL,
            model             TEXT NOT NULL,
            status            TEXT NOT NULL,
            error_msg         TEXT NOT NULL DEFAULT '',
            req_bytes         INTEGER NOT NULL DEFAULT 0,
            image_bytes       INTEGER NOT NULL DEFAULT 0,
            elapsed_ms        INTEGER NOT NULL DEFAULT 0,
            prompt            TEXT NOT NULL DEFAULT '',
            response          TEXT NOT NULL DEFAULT '',
            prompt_tokens     INTEGER NOT NULL DEFAULT 0,
            completion_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens      INTEGER NOT NULL DEFAULT 0,
            image_hash        TEXT NOT NULL DEFAULT ''
        );",
    )
    .map_err(|e| e.to_string())?;
    let _ = conn.execute(
        "ALTER TABLE ai_calls ADD COLUMN image_hash TEXT NOT NULL DEFAULT ''",
        [],
    );
    Ok(conn)
}

/// Split messages into (prompt text, approx image payload bytes).
fn extract_prompt(messages: &serde_json::Value) -> (String, i64) {
    let mut prompt = String::new();
    let mut image_bytes: i64 = 0;
    let empty = vec![];
    let list = messages.as_array().unwrap_or(&empty);
    for msg in list {
        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("?");
        match msg.get("content") {
            Some(serde_json::Value::String(text)) => {
                prompt.push_str(&format!("[{role}]\n{text}\n"));
            }
            Some(serde_json::Value::Array(parts)) => {
                prompt.push_str(&format!("[{role}]\n"));
                for part in parts {
                    match part.get("type").and_then(|t| t.as_str()) {
                        Some("text") => {
                            if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                                prompt.push_str(t);
                                prompt.push('\n');
                            }
                        }
                        Some("image_url") => {
                            let url = part
                                .pointer("/image_url/url")
                                .and_then(|u| u.as_str())
                                .unwrap_or("");
                            let b64 = url.split(',').nth(1).unwrap_or("");
                            image_bytes += b64.len() as i64 * 3 / 4;
                            prompt.push_str("[image]\n");
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
    (prompt.trim_end().to_string(), image_bytes)
}

#[allow(clippy::too_many_arguments)]
fn record_call(
    app: &tauri::AppHandle,
    source: &str,
    model: &str,
    status: &str,
    error_msg: &str,
    req_bytes: i64,
    image_bytes: i64,
    elapsed_ms: i64,
    prompt: &str,
    response: &str,
    usage: Option<&serde_json::Value>,
    image_hash: &str,
) {
    let get_token = |key: &str| -> i64 {
        usage
            .and_then(|u| u.get(key))
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
    };
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let result = (|| -> Result<(), String> {
        let conn = open_db(app)?;
        conn.execute(
            "INSERT INTO ai_calls (
                created_at, source, model, status, error_msg, req_bytes, image_bytes,
                elapsed_ms, prompt, response, prompt_tokens, completion_tokens, total_tokens, image_hash
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                created_at, source, model, status, error_msg, req_bytes, image_bytes,
                elapsed_ms, prompt, response,
                get_token("prompt_tokens"),
                get_token("completion_tokens"),
                get_token("total_tokens"),
                image_hash,
            ],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM ai_calls WHERE id NOT IN (SELECT id FROM ai_calls ORDER BY id DESC LIMIT ?1)",
            params![MAX_RECORDS],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(e) = result {
        log::warn!("[AI] failed to record call: {}", e);
    }
}

const CALL_COLUMNS: &str = "id, created_at, source, model, status, error_msg, req_bytes, image_bytes,
                elapsed_ms, prompt, response, prompt_tokens, completion_tokens, total_tokens, image_hash";

fn map_call_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<AiCallRecord> {
    Ok(AiCallRecord {
        id: r.get(0)?,
        created_at: r.get(1)?,
        source: r.get(2)?,
        model: r.get(3)?,
        status: r.get(4)?,
        error_msg: r.get(5)?,
        req_bytes: r.get(6)?,
        image_bytes: r.get(7)?,
        elapsed_ms: r.get(8)?,
        prompt: r.get(9)?,
        response: r.get(10)?,
        prompt_tokens: r.get(11)?,
        completion_tokens: r.get(12)?,
        total_tokens: r.get(13)?,
        image_hash: r.get::<_, Option<String>>(14)?.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn ai_list_calls(
    app: tauri::AppHandle,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<Vec<AiCallRecord>, String> {
    let conn = open_db(&app)?;
    let limit = limit.unwrap_or(50).min(500) as i64;
    let offset = offset.unwrap_or(0) as i64;
    let sql = format!(
        "SELECT {} FROM ai_calls ORDER BY id DESC LIMIT ?1 OFFSET ?2",
        CALL_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit, offset], map_call_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Latest successful OCR result for a given clipboard image hash.
#[tauri::command]
pub fn ai_get_call_by_hash(app: tauri::AppHandle, hash: String) -> Result<Option<AiCallRecord>, String> {
    let conn = open_db(&app)?;
    let sql = format!(
        "SELECT {} FROM ai_calls WHERE image_hash = ?1 AND status = 'ok' AND response != '' ORDER BY id DESC LIMIT 1",
        CALL_COLUMNS
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query_map(params![hash], map_call_row)
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(Ok(r)) => Ok(Some(r)),
        Some(Err(e)) => Err(e.to_string()),
        None => Ok(None),
    }
}

/// Hashes of clipboard images that have a usable OCR result.
#[tauri::command]
pub fn ai_ocr_hashes(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let conn = open_db(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT image_hash FROM ai_calls
             WHERE image_hash != '' AND status = 'ok' AND response != ''",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// Archived compressed image for a hash, as a JPEG data URL.
#[tauri::command]
pub fn ai_get_image_by_hash(app: tauri::AppHandle, hash: String) -> Option<String> {
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let path = app
        .path()
        .app_data_dir()
        .ok()?
        .join("userData")
        .join("ai-images")
        .join(format!("{}.jpg", hash));
    let bytes = std::fs::read(path).ok()?;
    use base64::Engine;
    Some(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

#[tauri::command]
pub fn ai_clear_calls(app: tauri::AppHandle) -> Result<(), String> {
    let conn = open_db(&app)?;
    conn.execute("DELETE FROM ai_calls", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn ai_chat_completion(
    app: tauri::AppHandle,
    request: AiChatRequest,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let base = request.base_url.trim_end_matches('/');
    let url = if base.ends_with("/chat/completions") {
        base.to_string()
    } else {
        format!("{}/chat/completions", base)
    };

    let mut payload = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
    });

    if let Some(tokens) = request.max_tokens {
        payload["max_tokens"] = serde_json::json!(tokens);
    }
    if let Some(temp) = request.temperature {
        payload["temperature"] = serde_json::json!(temp);
    }
    if let Some(thinking) = request.enable_thinking {
        payload["enable_thinking"] = serde_json::json!(thinking);
    }

    let payload_str = payload.to_string();
    let req_bytes = payload_str.len() as i64;
    let source = request.source.clone().unwrap_or_default();
    let image_hash = request.image_hash.clone().unwrap_or_default();
    let (prompt, image_bytes) = extract_prompt(&request.messages);
    let start = std::time::Instant::now();
    log::info!(
        "[AI] chat_completion start source={} model={} req_bytes={}",
        source, request.model, req_bytes
    );

    let resp = match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", request.api_key.trim()))
        .header("Content-Type", "application/json")
        .body(payload_str)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as i64;
            log::error!(
                "[AI] chat_completion network error model={} elapsed={}ms err={}",
                request.model, elapsed, e
            );
            record_call(
                &app, &source, &request.model, "error", &format!("网络请求失败: {e}"),
                req_bytes, image_bytes, elapsed, &prompt, "", None, &image_hash,
            );
            return Err(format!("网络请求失败: {}", e));
        }
    };

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    let elapsed_ms = start.elapsed().as_millis() as i64;

    if !status.is_success() {
        log::error!(
            "[AI] chat_completion failed model={} status={} elapsed={}ms",
            request.model, status.as_u16(), elapsed_ms
        );
        let mut err_msg = text.clone();
        if let Ok(err_val) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(msg) = err_val
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
            {
                err_msg = msg.to_string();
            } else if let Some(msg) = err_val.get("message").and_then(|m| m.as_str()) {
                err_msg = msg.to_string();
            }
        }
        let err_msg = format!("HTTP {}: {}", status.as_u16(), err_msg);
        record_call(
            &app, &source, &request.model, "error", &err_msg,
            req_bytes, image_bytes, elapsed_ms, &prompt, "", None, &image_hash,
        );
        return Err(err_msg);
    }

    match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(val) => {
            log::info!(
                "[AI] chat_completion ok model={} req_bytes={} resp_chars={} elapsed={}ms",
                request.model, req_bytes, text.len(), elapsed_ms
            );
            let content = val
                .pointer("/choices/0/message/content")
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            let usage = val.get("usage");
            record_call(
                &app, &source, &request.model, "ok", "",
                req_bytes, image_bytes, elapsed_ms, &prompt, &content, usage, &image_hash,
            );
            Ok(val)
        }
        Err(e) => {
            log::error!(
                "[AI] chat_completion bad JSON model={} elapsed={}ms err={}",
                request.model, elapsed_ms, e
            );
            record_call(
                &app, &source, &request.model, "error",
                &format!("响应 JSON 解析失败: {e}"),
                req_bytes, image_bytes, elapsed_ms, &prompt, &text, None, &image_hash,
            );
            Err(format!("响应 JSON 解析失败: {}", e))
        }
    }
}

/// Fetch the model list from an OpenAI-compatible provider (GET {base_url}/models).
#[tauri::command]
pub async fn ai_list_models(request: AiListModelsRequest) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let base = request.base_url.trim_end_matches('/');
    let url = format!("{}/models", base);
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", request.api_key.trim()))
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let mut err_msg = text.clone();
        if let Ok(err_val) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(msg) = err_val
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
            {
                err_msg = msg.to_string();
            }
        }
        log::error!("[AI] list_models failed base={} status={}", base, status.as_u16());
        return Err(format!("HTTP {}: {}", status.as_u16(), err_msg));
    }
    let val: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("响应解析失败: {}", e))?;
    let mut models: Vec<String> = val
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()))
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    models.dedup();
    log::info!("[AI] list_models ok base={} count={}", base, models.len());
    Ok(models)
}
