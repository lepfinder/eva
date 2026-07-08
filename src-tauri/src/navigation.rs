//! Navigation module – manages website bookmarks/navigation data, icons, and browser actions.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ── Data types ────────────────────────────────────────────────────────────────

fn default_true() -> bool { true }

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct NavLinkItem {
    pub id: String,
    pub title: String,
    pub href: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub browser: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct NavSubCategory {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub items: Vec<NavLinkItem>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NavCategory {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub items: Vec<NavLinkItem>,
    #[serde(rename = "subCategories", default)]
    pub sub_categories: Vec<NavSubCategory>,
}

#[derive(Serialize, Deserialize, Debug, Default)]
pub struct NavigationData {
    #[serde(rename = "navigationItems")]
    pub navigation_items: Vec<NavCategory>,
}

// ── Path helpers ──────────────────────────────────────────────────────────────

fn user_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("app_data_dir unavailable")
        .join("userData")
}

fn nav_dir(app: &AppHandle) -> PathBuf {
    user_data_dir(app).join("navigation")
}

fn nav_file(app: &AppHandle) -> PathBuf {
    nav_dir(app).join("navigation.json")
}

fn icons_dir(app: &AppHandle) -> PathBuf {
    nav_dir(app).join("icons")
}

fn ensure_dirs(app: &AppHandle) {
    let _ = fs::create_dir_all(icons_dir(app));
}

// ── Load / save ───────────────────────────────────────────────────────────────

fn load(app: &AppHandle) -> NavigationData {
    let path = nav_file(app);
    if !path.exists() {
        return NavigationData::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn persist(app: &AppHandle, data: &NavigationData) -> Result<(), String> {
    ensure_dirs(app);
    let json = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(nav_file(app), json).map_err(|e| e.to_string())
}

// ── Icon helpers ──────────────────────────────────────────────────────────────

fn mime_for_ext(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "image/png",
    }
}

fn icon_to_data_url(app: &AppHandle, name: &str) -> Option<String> {
    let path = icons_dir(app).join(name);
    if !path.exists() {
        return None;
    }
    let bytes = fs::read(&path).ok()?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    Some(format!("data:{};base64,{}", mime_for_ext(&ext), B64.encode(&bytes)))
}

// ── Simple string helpers for HTML parsing ────────────────────────────────────

fn extract_attr(tag: &str, attr: &str) -> Option<String> {
    let lower = tag.to_lowercase();
    let dq = format!("{}=\"", attr);
    let sq = format!("{}='", attr);
    if let Some(start) = lower.find(&dq) {
        let cs = start + dq.len();
        if let Some(end) = tag[cs..].find('"') {
            let v = tag[cs..cs + end].trim().to_owned();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    if let Some(start) = lower.find(&sq) {
        let cs = start + sq.len();
        if let Some(end) = tag[cs..].find('\'') {
            let v = tag[cs..cs + end].trim().to_owned();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let cs = html[start..].find('>')? + start + 1;
    let end = lower[cs..].find("</title>")? + cs;
    let text = html[cs..end].trim().to_owned();
    if text.is_empty() { None } else { Some(text) }
}

fn extract_meta_content(html: &str, name: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let pat1 = format!("name=\"{}\"", name.to_lowercase());
    let pat2 = format!("name='{}'", name.to_lowercase());
    let pat3 = format!("property=\"{}\"", name.to_lowercase());
    let pat4 = format!("property='{}'", name.to_lowercase());
    let pos = [&pat1, &pat2, &pat3, &pat4]
        .iter()
        .find_map(|p| lower.find(p.as_str()))?;
    let meta_start = lower[..pos].rfind("<meta")?;
    let tag_end = html[meta_start..].find('>')? + meta_start + 1;
    extract_attr(&html[meta_start..tag_end], "content")
}

fn normalize_url(href: &str, origin: &str) -> String {
    if href.starts_with("http") {
        href.to_owned()
    } else if href.starts_with("//") {
        format!("https:{}", href)
    } else if href.starts_with('/') {
        format!("{}{}", origin, href)
    } else {
        format!("{}/{}", origin, href)
    }
}

fn url_origin(url: &str) -> String {
    if let Ok(parsed) = url::Url::parse(url) {
        let scheme = parsed.scheme();
        let host = parsed.host_str().unwrap_or("");
        if let Some(port) = parsed.port() {
            format!("{}://{}:{}", scheme, host, port)
        } else {
            format!("{}://{}", scheme, host)
        }
    } else {
        url.to_owned()
    }
}

fn extract_domain(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_owned()))
        .unwrap_or_default()
}

fn find_best_favicon(html: &str, origin: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let mut pos = 0;
    let mut best: Option<(u8, String)> = None;

    loop {
        let rel_pos = lower[pos..].find("<link")?;
        let abs = pos + rel_pos;
        let tag_end = lower[abs..].find('>').map(|p| abs + p + 1)?;
        let tag = &html[abs..tag_end];
        let tag_lower = &lower[abs..tag_end];
        pos = tag_end;

        if !tag_lower.contains("icon") {
            if pos >= lower.len() { break; }
            continue;
        }
        if let Some(href) = extract_attr(tag, "href") {
            if !href.starts_with("data:") {
                let priority: u8 = if tag_lower.contains("apple-touch-icon-precomposed") { 30 }
                    else if tag_lower.contains("apple-touch-icon") { 20 }
                    else if tag_lower.contains("shortcut icon") { 5 }
                    else { 10 };
                if best.as_ref().map_or(true, |(p, _)| priority > *p) {
                    best = Some((priority, normalize_url(&href, origin)));
                }
            }
        }
        if pos >= lower.len() {
            break;
        }
    }
    best.map(|(_, href)| href)
}

/// FNV-1a hash for generating stable icon filenames
fn fnv1a(s: &str) -> u64 {
    let mut hash: u64 = 14695981039346656037;
    for b in s.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    hash
}

async fn download_icon(
    app: &AppHandle,
    client: &reqwest::Client,
    url: &str,
) -> Result<String, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_owned();

    let ext = if content_type.contains("svg") { "svg" }
        else if content_type.contains("webp") { "webp" }
        else if content_type.contains("jpeg") || content_type.contains("jpg") { "jpg" }
        else if content_type.contains("gif") { "gif" }
        else if content_type.contains("x-icon") || url.ends_with(".ico") { "ico" }
        else { "png" };

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("Empty response".to_owned());
    }

    let filename = format!("{:016x}.{}", fnv1a(url), ext);
    let dest = icons_dir(app).join(&filename);
    fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(filename)
}

fn make_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

// ── Tauri commands – core data ────────────────────────────────────────────────

#[tauri::command]
pub fn get_navigation_data(app: AppHandle) -> NavigationData {
    load(&app)
}

#[tauri::command]
pub fn save_navigation_data(app: AppHandle, data: NavigationData) -> Result<(), String> {
    persist(&app, &data)
}

#[tauri::command]
pub fn get_navigation_data_dir(app: AppHandle) -> String {
    nav_dir(&app).to_string_lossy().into_owned()
}

// ── Tauri commands – icons ────────────────────────────────────────────────────

#[tauri::command]
pub fn get_nav_icon_data(app: AppHandle, icon_name: String) -> Option<String> {
    icon_to_data_url(&app, &icon_name)
}

#[tauri::command]
pub fn get_icon_list(app: AppHandle) -> Vec<serde_json::Value> {
    let dir = icons_dir(&app);
    if !dir.exists() {
        return vec![];
    }
    let Ok(entries) = fs::read_dir(&dir) else { return vec![] };
    entries.flatten().filter_map(|e| {
        let meta = e.metadata().ok()?;
        if !meta.is_file() { return None; }
        let name = e.file_name().to_string_lossy().into_owned();
        let size = meta.len();
        let modified = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Some(serde_json::json!({ "name": name, "size": size, "modifiedTime": modified }))
    }).collect()
}

#[tauri::command]
pub fn delete_icon(app: AppHandle, icon_name: String) -> Result<(), String> {
    let path = icons_dir(&app).join(&icon_name);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_icons(app: AppHandle, icon_names: Vec<String>) -> serde_json::Value {
    let mut deleted = 0u32;
    let mut errors: Vec<String> = vec![];
    for name in icon_names {
        let path = icons_dir(&app).join(&name);
        if path.exists() {
            match fs::remove_file(&path) {
                Ok(_) => deleted += 1,
                Err(e) => errors.push(format!("{}: {}", name, e)),
            }
        }
    }
    serde_json::json!({ "success": errors.is_empty(), "deleted": deleted, "errors": errors })
}

// ── Tauri commands – navigation item CRUD ────────────────────────────────────

#[tauri::command]
pub fn add_navigation_item(
    app: AppHandle,
    category_id: String,
    sub_category_id: Option<String>,
    item: NavLinkItem,
) -> Result<(), String> {
    let mut data = load(&app);
    let cat = data.navigation_items.iter_mut()
        .find(|c| c.id == category_id)
        .ok_or("Category not found")?;
    match sub_category_id {
        Some(sid) => cat.sub_categories.iter_mut()
            .find(|s| s.id == sid)
            .ok_or("Sub-category not found")?
            .items.push(item),
        None => cat.items.push(item),
    }
    persist(&app, &data)
}

#[tauri::command]
pub fn update_navigation_item(
    app: AppHandle,
    category_id: String,
    sub_category_id: Option<String>,
    item_id: String,
    updates: serde_json::Value,
) -> Result<(), String> {
    let mut data = load(&app);
    let cat = data.navigation_items.iter_mut()
        .find(|c| c.id == category_id)
        .ok_or("Category not found")?;
    let items = match sub_category_id {
        Some(sid) => &mut cat.sub_categories.iter_mut()
            .find(|s| s.id == sid)
            .ok_or("Sub-category not found")?
            .items,
        None => &mut cat.items,
    };
    let item = items.iter_mut().find(|i| i.id == item_id).ok_or("Item not found")?;
    if let Some(v) = updates.get("title").and_then(|v| v.as_str()) { item.title = v.to_owned(); }
    if let Some(v) = updates.get("href").and_then(|v| v.as_str()) { item.href = v.to_owned(); }
    if let Some(v) = updates.get("description").and_then(|v| v.as_str()) { item.description = v.to_owned(); }
    if let Some(v) = updates.get("icon").and_then(|v| v.as_str()) { item.icon = v.to_owned(); }
    if let Some(v) = updates.get("enabled").and_then(|v| v.as_bool()) { item.enabled = v; }
    if let Some(v) = updates.get("browser") {
        item.browser = if v.is_null() { None } else { v.as_str().map(|s| s.to_owned()) };
    }
    persist(&app, &data)
}

#[tauri::command]
pub fn remove_navigation_item(
    app: AppHandle,
    category_id: String,
    sub_category_id: Option<String>,
    item_id: String,
) -> Result<(), String> {
    let mut data = load(&app);
    let cat = data.navigation_items.iter_mut()
        .find(|c| c.id == category_id)
        .ok_or("Category not found")?;
    match sub_category_id {
        Some(sid) => cat.sub_categories.iter_mut()
            .find(|s| s.id == sid)
            .ok_or("Sub-category not found")?
            .items.retain(|i| i.id != item_id),
        None => cat.items.retain(|i| i.id != item_id),
    }
    persist(&app, &data)
}

#[tauri::command]
pub fn move_navigation_item(
    app: AppHandle,
    from_category_id: String,
    from_sub_category_id: Option<String>,
    item_id: String,
    to_category_id: String,
    to_sub_category_id: Option<String>,
) -> Result<(), String> {
    let mut data = load(&app);

    // Extract item from source
    let item = {
        let from_cat = data.navigation_items.iter_mut()
            .find(|c| c.id == from_category_id)
            .ok_or("Source category not found")?;
        let from_items = match from_sub_category_id {
            Some(ref sid) => &mut from_cat.sub_categories.iter_mut()
                .find(|s| s.id == *sid)
                .ok_or("Source sub-category not found")?
                .items,
            None => &mut from_cat.items,
        };
        let idx = from_items.iter().position(|i| i.id == item_id).ok_or("Item not found")?;
        from_items.remove(idx)
    };

    // Insert into destination
    let to_cat = data.navigation_items.iter_mut()
        .find(|c| c.id == to_category_id)
        .ok_or("Target category not found")?;
    match to_sub_category_id {
        Some(sid) => to_cat.sub_categories.iter_mut()
            .find(|s| s.id == sid)
            .ok_or("Target sub-category not found")?
            .items.push(item),
        None => to_cat.items.push(item),
    }
    persist(&app, &data)
}

// ── Tauri commands – category CRUD ───────────────────────────────────────────

#[tauri::command]
pub fn add_category(app: AppHandle, category: NavCategory) -> Result<(), String> {
    let mut data = load(&app);
    data.navigation_items.push(category);
    persist(&app, &data)
}

#[tauri::command]
pub fn update_category(
    app: AppHandle,
    category_id: String,
    updates: serde_json::Value,
) -> Result<(), String> {
    let mut data = load(&app);
    let cat = data.navigation_items.iter_mut()
        .find(|c| c.id == category_id)
        .ok_or("Category not found")?;
    if let Some(v) = updates.get("title").and_then(|v| v.as_str()) { cat.title = v.to_owned(); }
    if let Some(v) = updates.get("icon").and_then(|v| v.as_str()) { cat.icon = v.to_owned(); }
    if let Some(v) = updates.get("description").and_then(|v| v.as_str()) { cat.description = v.to_owned(); }
    if let Some(v) = updates.get("enabled").and_then(|v| v.as_bool()) { cat.enabled = v; }
    persist(&app, &data)
}

#[tauri::command]
pub fn remove_category(app: AppHandle, category_id: String) -> Result<(), String> {
    let mut data = load(&app);
    data.navigation_items.retain(|c| c.id != category_id);
    persist(&app, &data)
}

#[tauri::command]
pub fn reorder_categories(app: AppHandle, category_ids: Vec<String>) -> Result<(), String> {
    let mut data = load(&app);
    data.navigation_items.sort_by_key(|c| {
        category_ids.iter().position(|id| *id == c.id).unwrap_or(usize::MAX)
    });
    persist(&app, &data)
}

// ── Tauri commands – sub-category CRUD ───────────────────────────────────────

#[tauri::command]
pub fn add_sub_category(
    app: AppHandle,
    category_id: String,
    sub_category: NavSubCategory,
) -> Result<(), String> {
    let mut data = load(&app);
    let cat = data.navigation_items.iter_mut()
        .find(|c| c.id == category_id)
        .ok_or("Category not found")?;
    cat.sub_categories.push(sub_category);
    persist(&app, &data)
}

#[tauri::command]
pub fn update_sub_category(
    app: AppHandle,
    category_id: String,
    sub_category_id: String,
    updates: serde_json::Value,
) -> Result<(), String> {
    let mut data = load(&app);
    let sub = data.navigation_items.iter_mut()
        .find(|c| c.id == category_id).ok_or("Category not found")?
        .sub_categories.iter_mut()
        .find(|s| s.id == sub_category_id).ok_or("Sub-category not found")?;
    if let Some(v) = updates.get("title").and_then(|v| v.as_str()) { sub.title = v.to_owned(); }
    if let Some(v) = updates.get("icon").and_then(|v| v.as_str()) { sub.icon = v.to_owned(); }
    if let Some(v) = updates.get("description").and_then(|v| v.as_str()) { sub.description = v.to_owned(); }
    if let Some(v) = updates.get("enabled").and_then(|v| v.as_bool()) { sub.enabled = v; }
    persist(&app, &data)
}

#[tauri::command]
pub fn remove_sub_category(
    app: AppHandle,
    category_id: String,
    sub_category_id: String,
) -> Result<(), String> {
    let mut data = load(&app);
    let cat = data.navigation_items.iter_mut()
        .find(|c| c.id == category_id)
        .ok_or("Category not found")?;
    cat.sub_categories.retain(|s| s.id != sub_category_id);
    persist(&app, &data)
}

#[tauri::command]
pub fn reorder_sub_categories(
    app: AppHandle,
    category_id: String,
    sub_category_ids: Vec<String>,
) -> Result<(), String> {
    let mut data = load(&app);
    let cat = data.navigation_items.iter_mut()
        .find(|c| c.id == category_id)
        .ok_or("Category not found")?;
    cat.sub_categories.sort_by_key(|s| {
        sub_category_ids.iter().position(|id| *id == s.id).unwrap_or(usize::MAX)
    });
    persist(&app, &data)
}

// ── Tauri commands – browser / network ───────────────────────────────────────

#[tauri::command]
pub fn open_nav_link_in_browser(url: String, _browser: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_site_info(app: AppHandle, url: String) -> serde_json::Value {
    let client = match make_http_client() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "success": false, "error": e }),
    };

    let html = match client.get(&url).send().await {
        Ok(resp) => match resp.text().await {
            Ok(text) => text,
            Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
        },
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };

    let title = extract_title(&html);
    let description = extract_meta_content(&html, "description")
        .or_else(|| extract_meta_content(&html, "og:description"));
    let origin = url_origin(&url);
    let favicon_url = find_best_favicon(&html, &origin)
        .or_else(|| Some(format!("{}/favicon.ico", origin)));

    let icon_filename = if let Some(fav_url) = favicon_url {
        download_icon(&app, &client, &fav_url).await.ok()
    } else {
        None
    };

    serde_json::json!({
        "success": true,
        "title": title,
        "description": description,
        "icon": icon_filename,
    })
}

#[tauri::command]
pub async fn download_favicon(app: AppHandle, url: String, source: String) -> serde_json::Value {
    let domain = extract_domain(&url);
    let favicon_url = match source.as_str() {
        "faviconim" => format!("https://favicon.im/{}", domain),
        _ => format!("https://www.google.com/s2/favicons?domain={}&sz=64", domain),
    };

    let client = match make_http_client() {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "success": false, "error": e }),
    };

    match download_icon(&app, &client, &favicon_url).await {
        Ok(filename) => serde_json::json!({ "success": true, "filename": filename }),
        Err(e) => serde_json::json!({ "success": false, "error": e }),
    }
}

// ── Tauri commands – import ───────────────────────────────────────────────────

#[tauri::command]
pub fn import_navigation_data(app: AppHandle, source_path: String) -> serde_json::Value {
    let path = std::path::Path::new(&source_path);
    if !path.exists() {
        return serde_json::json!({ "success": false, "error": "Source file not found" });
    }
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };
    let data: NavigationData = match serde_json::from_str(&content) {
        Ok(d) => d,
        Err(e) => return serde_json::json!({ "success": false, "error": e.to_string() }),
    };
    match persist(&app, &data) {
        Ok(_) => serde_json::json!({ "success": true }),
        Err(e) => serde_json::json!({ "success": false, "error": e }),
    }
}
