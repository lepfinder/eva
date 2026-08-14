use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: serde_json::Value,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[tauri::command]
pub async fn ai_chat_completion(
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

    let payload_str = payload.to_string();

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", request.api_key.trim()))
        .header("Content-Type", "application/json")
        .body(payload_str)
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status.is_success() {
        serde_json::from_str(&text).map_err(|e| format!("响应 JSON 解析失败: {}", e))
    } else {
        // Try parsing error message from JSON
        if let Ok(err_val) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(msg) = err_val.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
                return Err(format!("HTTP {}: {}", status.as_u16(), msg));
            }
            if let Some(msg) = err_val.get("message").and_then(|m| m.as_str()) {
                return Err(format!("HTTP {}: {}", status.as_u16(), msg));
            }
        }
        Err(format!("HTTP {}: {}", status.as_u16(), text))
    }
}
