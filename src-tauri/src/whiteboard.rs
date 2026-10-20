//! Whiteboard — 图片拼贴白板
//!
//! 路径：userData/whiteboard.db + userData/whiteboard/{board_id}/*.png
//! 白板坐标系以 CSS px 为单位，与前端视口缩放无关；导出时按元素 w/h 在原生分辨率下重采样。

use base64::Engine;
use image::GenericImageView;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const DB_FILENAME: &str = "whiteboard.db";
const IMAGE_ROOT: &str = "whiteboard";
const THUMB_MAX_EDGE: u32 = 320;
/// 新图片落到白板上的默认显示尺寸上限。Retina 截图原生像素很大，按原尺寸铺会瞬间盖满画布。
const DEFAULT_MAX_EDGE: f64 = 720.0;

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub name: String,
    pub sort_order: i64,
    pub viewport_x: f64,
    pub viewport_y: f64,
    pub viewport_scale: f64,
    pub image_count: i64,
    /// 最近一张图的缩略图，供白板列表做预览
    pub cover_path: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardImage {
    pub id: String,
    pub board_id: String,
    pub file_path: String,
    pub thumb_path: Option<String>,
    pub natural_width: u32,
    pub natural_height: u32,
    /// 非破坏性裁剪框，自然像素单位；默认等于整图
    pub crop_x: f64,
    pub crop_y: f64,
    pub crop_w: f64,
    pub crop_h: f64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z_index: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardDetail {
    pub board: Board,
    pub images: Vec<BoardImage>,
    pub texts: Vec<BoardText>,
}

/// 文字贴图。color 为 'auto'（跟随主题）或 #rrggbb
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardText {
    pub id: String,
    pub board_id: String,
    pub text: String,
    pub color: String,
    pub font_size: f64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z_index: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextTransform {
    pub id: String,
    pub text: String,
    pub color: String,
    pub font_size: f64,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z_index: i64,
}

/// 拖拽/缩放结束后批量回写的几何信息
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageTransform {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub z_index: i64,
    pub crop_x: f64,
    pub crop_y: f64,
    pub crop_w: f64,
    pub crop_h: f64,
}

pub struct WhiteboardState {
    pub db_path: PathBuf,
    pub user_data_dir: PathBuf,
}

pub type SharedWhiteboardState = Arc<Mutex<WhiteboardState>>;

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

fn image_root(user_data: &Path) -> PathBuf {
    user_data.join(IMAGE_ROOT)
}

fn board_dir(user_data: &Path, board_id: &str) -> PathBuf {
    image_root(user_data).join(board_id)
}

fn open_db(user_data: &Path) -> Result<Connection, String> {
    let path = db_path(user_data);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    let _ = conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS boards (
            id             TEXT PRIMARY KEY,
            name           TEXT NOT NULL DEFAULT '',
            sort_order     INTEGER NOT NULL DEFAULT 0,
            viewport_x     REAL NOT NULL DEFAULT 0,
            viewport_y     REAL NOT NULL DEFAULT 0,
            viewport_scale REAL NOT NULL DEFAULT 1,
            created_at     INTEGER NOT NULL,
            updated_at     INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS board_images (
            id             TEXT PRIMARY KEY,
            board_id       TEXT NOT NULL,
            file_path      TEXT NOT NULL,
            thumb_path     TEXT,
            natural_width  INTEGER NOT NULL DEFAULT 0,
            natural_height INTEGER NOT NULL DEFAULT 0,
            crop_x         REAL NOT NULL DEFAULT 0,
            crop_y         REAL NOT NULL DEFAULT 0,
            crop_w         REAL NOT NULL DEFAULT 0,
            crop_h         REAL NOT NULL DEFAULT 0,
            x              REAL NOT NULL DEFAULT 0,
            y              REAL NOT NULL DEFAULT 0,
            w              REAL NOT NULL DEFAULT 0,
            h              REAL NOT NULL DEFAULT 0,
            z_index        INTEGER NOT NULL DEFAULT 0,
            created_at     INTEGER NOT NULL,
            FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_board_images_board ON board_images(board_id, z_index);

        CREATE TABLE IF NOT EXISTS board_texts (
            id         TEXT PRIMARY KEY,
            board_id   TEXT NOT NULL,
            text       TEXT NOT NULL DEFAULT '',
            color      TEXT NOT NULL DEFAULT 'auto',
            font_size  REAL NOT NULL DEFAULT 24,
            x          REAL NOT NULL DEFAULT 0,
            y          REAL NOT NULL DEFAULT 0,
            w          REAL NOT NULL DEFAULT 240,
            h          REAL NOT NULL DEFAULT 32,
            z_index    INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_board_texts_board ON board_texts(board_id, z_index);
        ",
    )
    .map_err(|e| e.to_string())?;

    // 旧库迁移：P0 建表时还没有 crop 列
    for col in ["crop_x", "crop_y", "crop_w", "crop_h"] {
        ensure_column(conn, "board_images", col, "REAL NOT NULL DEFAULT 0")?;
    }
    // crop 默认值 0 表示「未设置」，读取时回退为整图
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<(), String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    if !names.iter().any(|n| n == column) {
        conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, decl),
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn state_user_data(state: &State<SharedWhiteboardState>) -> Result<PathBuf, String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.user_data_dir.clone())
}

fn row_to_board(conn: &Connection, row: &rusqlite::Row) -> rusqlite::Result<Board> {
    let id: String = row.get(0)?;
    let cover: Option<String> = conn
        .query_row(
            "SELECT thumb_path FROM board_images
             WHERE board_id = ?1 AND thumb_path IS NOT NULL
             ORDER BY created_at DESC LIMIT 1",
            params![id],
            |r| r.get(0),
        )
        .ok();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM board_images WHERE board_id = ?1",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(Board {
        image_count: count,
        cover_path: cover,
        id,
        name: row.get(1)?,
        sort_order: row.get(2)?,
        viewport_x: row.get(3)?,
        viewport_y: row.get(4)?,
        viewport_scale: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const BOARD_COLUMNS: &str = "id, name, sort_order, viewport_x, viewport_y, viewport_scale, created_at, updated_at";

fn load_board(conn: &Connection, id: &str) -> Result<Board, String> {
    let sql = format!("SELECT {BOARD_COLUMNS} FROM boards WHERE id = ?1");
    conn.query_row(&sql, params![id], |row| row_to_board(conn, row))
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("白板不存在: {id}"))
}

fn load_images(conn: &Connection, board_id: &str) -> Result<Vec<BoardImage>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, board_id, file_path, thumb_path, natural_width, natural_height,
                    crop_x, crop_y, crop_w, crop_h,
                    x, y, w, h, z_index, created_at
             FROM board_images WHERE board_id = ?1 ORDER BY z_index ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![board_id], |row| {
            let natural_width: u32 = row.get(4)?;
            let natural_height: u32 = row.get(5)?;
            let mut crop_x: f64 = row.get(6)?;
            let mut crop_y: f64 = row.get(7)?;
            let mut crop_w: f64 = row.get(8)?;
            let mut crop_h: f64 = row.get(9)?;
            // 旧数据 crop 为 0 表示未裁剪，回退为整图
            if crop_w <= 0.0 || crop_h <= 0.0 {
                crop_x = 0.0;
                crop_y = 0.0;
                crop_w = natural_width as f64;
                crop_h = natural_height as f64;
            }
            Ok(BoardImage {
                id: row.get(0)?,
                board_id: row.get(1)?,
                file_path: row.get(2)?,
                thumb_path: row.get(3)?,
                natural_width,
                natural_height,
                crop_x,
                crop_y,
                crop_w,
                crop_h,
                x: row.get(10)?,
                y: row.get(11)?,
                w: row.get(12)?,
                h: row.get(13)?,
                z_index: row.get(14)?,
                created_at: row.get(15)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn load_texts(conn: &Connection, board_id: &str) -> Result<Vec<BoardText>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, board_id, text, color, font_size, x, y, w, h, z_index, created_at
             FROM board_texts WHERE board_id = ?1 ORDER BY z_index ASC, created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![board_id], |row| {
            Ok(BoardText {
                id: row.get(0)?,
                board_id: row.get(1)?,
                text: row.get(2)?,
                color: row.get(3)?,
                font_size: row.get(4)?,
                x: row.get(5)?,
                y: row.get(6)?,
                w: row.get(7)?,
                h: row.get(8)?,
                z_index: row.get(9)?,
                created_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn touch_board(conn: &Connection, board_id: &str) {
    let _ = conn.execute(
        "UPDATE boards SET updated_at = ?1 WHERE id = ?2",
        params![now_ms(), board_id],
    );
}

fn next_z_index(conn: &Connection, board_id: &str) -> i64 {
    conn.query_row(
        "SELECT COALESCE(MAX(z_index), -1) + 1 FROM (
            SELECT z_index FROM board_images WHERE board_id = ?1
            UNION ALL
            SELECT z_index FROM board_texts WHERE board_id = ?1
        )",
        params![board_id],
        |r| r.get(0),
    )
    .unwrap_or(0)
}

/// 解码图片字节，落盘为原图 + 缩略图。JPEG 直接原样写盘避免转 PNG 后体积膨胀。
fn store_image_bytes(
    user_data: &Path,
    board_id: &str,
    bytes: &[u8],
) -> Result<(PathBuf, Option<PathBuf>, u32, u32), String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("无法解析图片: {e}"))?;
    let (natural_width, natural_height) = img.dimensions();
    if natural_width == 0 || natural_height == 0 {
        return Err("图片尺寸非法".into());
    }

    let fmt = image::guess_format(bytes).unwrap_or(image::ImageFormat::Png);
    let is_jpeg = matches!(fmt, image::ImageFormat::Jpeg);
    let ext = if is_jpeg { "jpg" } else { "png" };

    let dir = board_dir(user_data, board_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stem = Uuid::new_v4().simple().to_string();
    let file_path = dir.join(format!("{stem}.{ext}"));

    if is_jpeg {
        fs::write(&file_path, bytes).map_err(|e| e.to_string())?;
    } else {
        img.save_with_format(&file_path, image::ImageFormat::Png)
            .map_err(|e| e.to_string())?;
    }

    let thumb_path = dir.join(format!("{stem}.thumb.png"));
    let thumb = if natural_width.max(natural_height) > THUMB_MAX_EDGE {
        img.thumbnail(THUMB_MAX_EDGE, THUMB_MAX_EDGE)
    } else {
        img
    };
    let saved_thumb = thumb
        .save_with_format(&thumb_path, image::ImageFormat::Png)
        .is_ok()
        .then_some(thumb_path);

    Ok((file_path, saved_thumb, natural_width, natural_height))
}

/// 按默认显示尺寸算出左上角坐标，使图片中心落在 center 上
fn default_geometry(natural_width: u32, natural_height: u32, center: (f64, f64)) -> (f64, f64, f64, f64) {
    let nw = natural_width as f64;
    let nh = natural_height as f64;
    let scale = (DEFAULT_MAX_EDGE / nw.max(nh)).min(1.0);
    let w = (nw * scale).max(1.0);
    let h = (nh * scale).max(1.0);
    (center.0 - w / 2.0, center.1 - h / 2.0, w, h)
}

/// 共用入库逻辑：写文件 + 插行
fn insert_image(
    conn: &Connection,
    user_data: &Path,
    board_id: &str,
    bytes: &[u8],
    center: (f64, f64),
) -> Result<BoardImage, String> {
    let (file_path, thumb_path, natural_width, natural_height) =
        store_image_bytes(user_data, board_id, bytes)?;
    let (x, y, w, h) = default_geometry(natural_width, natural_height, center);

    let id = Uuid::new_v4().to_string();
    let z_index = next_z_index(conn, board_id);
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO board_images
         (id, board_id, file_path, thumb_path, natural_width, natural_height,
          crop_x, crop_y, crop_w, crop_h, x, y, w, h, z_index, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
        params![
            id,
            board_id,
            file_path.to_string_lossy(),
            thumb_path.as_ref().map(|p| p.to_string_lossy().into_owned()),
            natural_width,
            natural_height,
            0.0,
            0.0,
            natural_width as f64,
            natural_height as f64,
            x,
            y,
            w,
            h,
            z_index,
            created_at
        ],
    )
    .map_err(|e| e.to_string())?;
    touch_board(conn, board_id);

    Ok(BoardImage {
        id,
        board_id: board_id.to_string(),
        file_path: file_path.to_string_lossy().into_owned(),
        thumb_path: thumb_path.map(|p| p.to_string_lossy().into_owned()),
        natural_width,
        natural_height,
        crop_x: 0.0,
        crop_y: 0.0,
        crop_w: natural_width as f64,
        crop_h: natural_height as f64,
        x,
        y,
        w,
        h,
        z_index,
        created_at,
    })
}

fn decode_data_url(data_base64: &str) -> Result<Vec<u8>, String> {
    let payload = match data_base64.find(',') {
        Some(idx) if data_base64.trim_start().starts_with("data:") => &data_base64[idx + 1..],
        _ => data_base64,
    };
    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("base64 解码失败: {e}"))
}

// ──────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────

pub fn init(app: &AppHandle) -> SharedWhiteboardState {
    let data_dir = app.path().app_data_dir().unwrap_or_else(|_| {
        dirs::data_dir()
            .map(|d| d.join("com.xiyangxie.eva"))
            .unwrap_or_else(|| PathBuf::from("./"))
    });
    let user_data = data_dir.join("userData");
    let _ = fs::create_dir_all(&user_data);
    let path = db_path(&user_data);

    match open_db(&user_data) {
        Ok(conn) => match init_schema(&conn) {
            Ok(()) => log::info!("[Whiteboard] DB ready at {}", path.display()),
            Err(e) => log::error!("[Whiteboard] schema init failed: {}", e),
        },
        Err(e) => log::error!("[Whiteboard] DB open failed: {}", e),
    }

    Arc::new(Mutex::new(WhiteboardState {
        db_path: path,
        user_data_dir: user_data,
    }))
}

// ──────────────────────────────────────────────────
// Commands — 白板
// ──────────────────────────────────────────────────

#[tauri::command]
pub fn whiteboard_list_boards(state: State<SharedWhiteboardState>) -> Result<Vec<Board>, String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    let sql = format!(
        "SELECT {BOARD_COLUMNS} FROM boards ORDER BY sort_order ASC, created_at DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row_to_board(&conn, row))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn whiteboard_create_board(
    state: State<SharedWhiteboardState>,
    name: Option<String>,
) -> Result<Board, String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    let resolved_name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "未命名白板".to_string());
    let sort_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM boards", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);

    conn.execute(
        "INSERT INTO boards (id, name, sort_order, viewport_x, viewport_y, viewport_scale, created_at, updated_at)
         VALUES (?1,?2,?3,0,0,1,?4,?4)",
        params![id, resolved_name, sort_order, now],
    )
    .map_err(|e| e.to_string())?;
    fs::create_dir_all(board_dir(&user_data, &id)).map_err(|e| e.to_string())?;

    load_board(&conn, &id)
}

#[tauri::command]
pub fn whiteboard_rename_board(
    state: State<SharedWhiteboardState>,
    id: String,
    name: String,
) -> Result<Board, String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("白板名称不能为空".into());
    }
    conn.execute(
        "UPDATE boards SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![trimmed, now_ms(), id],
    )
    .map_err(|e| e.to_string())?;
    load_board(&conn, &id)
}

#[tauri::command]
pub fn whiteboard_delete_board(
    state: State<SharedWhiteboardState>,
    id: String,
) -> Result<(), String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    conn.execute("DELETE FROM boards WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(board_dir(&user_data, &id));
    Ok(())
}

#[tauri::command]
pub fn whiteboard_get_board(
    state: State<SharedWhiteboardState>,
    id: String,
) -> Result<BoardDetail, String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    let board = load_board(&conn, &id)?;
    let images = load_images(&conn, &id)?;
    let texts = load_texts(&conn, &id)?;
    Ok(BoardDetail { board, images, texts })
}

#[tauri::command]
pub fn whiteboard_save_viewport(
    state: State<SharedWhiteboardState>,
    id: String,
    x: f64,
    y: f64,
    scale: f64,
) -> Result<(), String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    let clamped = scale.clamp(0.1, 4.0);
    conn.execute(
        "UPDATE boards SET viewport_x = ?1, viewport_y = ?2, viewport_scale = ?3 WHERE id = ?4",
        params![x, y, clamped, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ──────────────────────────────────────────────────
// Commands — 图片元素
// ──────────────────────────────────────────────────

/// 粘贴入口。center_x/center_y 为白板坐标系下的落点中心。
#[tauri::command]
pub fn whiteboard_add_image_from_bytes(
    state: State<SharedWhiteboardState>,
    board_id: String,
    data_base64: String,
    center_x: f64,
    center_y: f64,
) -> Result<BoardImage, String> {
    let user_data = state_user_data(&state)?;
    let bytes = decode_data_url(&data_base64)?;
    let conn = open_db(&user_data)?;
    load_board(&conn, &board_id)?;
    insert_image(&conn, &user_data, &board_id, &bytes, (center_x, center_y))
}

/// 拖文件入口。Tauri webview 会拦截 HTML5 drop，路径只能从 drag-drop 事件拿到后交给这里读盘。
#[tauri::command]
pub fn whiteboard_add_image_from_path(
    state: State<SharedWhiteboardState>,
    board_id: String,
    path: String,
    center_x: f64,
    center_y: f64,
) -> Result<BoardImage, String> {
    let user_data = state_user_data(&state)?;
    let bytes = fs::read(&path).map_err(|e| format!("读取文件失败: {e}"))?;
    let conn = open_db(&user_data)?;
    load_board(&conn, &board_id)?;
    insert_image(&conn, &user_data, &board_id, &bytes, (center_x, center_y))
}

#[tauri::command]
pub fn whiteboard_update_images_batch(
    state: State<SharedWhiteboardState>,
    board_id: String,
    items: Vec<ImageTransform>,
) -> Result<(), String> {
    let user_data = state_user_data(&state)?;
    let mut conn = open_db(&user_data)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for item in &items {
        tx.execute(
            "UPDATE board_images SET x = ?1, y = ?2, w = ?3, h = ?4, z_index = ?5,
                    crop_x = ?6, crop_y = ?7, crop_w = ?8, crop_h = ?9
             WHERE id = ?10 AND board_id = ?11",
            params![
                item.x,
                item.y,
                item.w.max(1.0),
                item.h.max(1.0),
                item.z_index,
                item.crop_x.max(0.0),
                item.crop_y.max(0.0),
                item.crop_w.max(1.0),
                item.crop_h.max(1.0),
                item.id,
                board_id
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    touch_board(&conn, &board_id);
    Ok(())
}

#[tauri::command]
pub fn whiteboard_delete_images(
    state: State<SharedWhiteboardState>,
    board_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    for id in &ids {
        let path: Option<String> = conn
            .query_row(
                "SELECT file_path FROM board_images WHERE id = ?1 AND board_id = ?2",
                params![id, board_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM board_images WHERE id = ?1 AND board_id = ?2",
            params![id, board_id],
        )
        .map_err(|e| e.to_string())?;
        if let Some(p) = path {
            let file = PathBuf::from(&p);
            let _ = fs::remove_file(&file);
            let _ = fs::remove_file(thumb_path_for(&file));
        }
    }
    touch_board(&conn, &board_id);
    Ok(())
}

fn thumb_path_for(image_path: &Path) -> PathBuf {
    let stem = image_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("image");
    image_path.with_file_name(format!("{stem}.thumb.png"))
}

// ──────────────────────────────────────────────────
// Commands — 文字贴图
// ──────────────────────────────────────────────────

#[tauri::command]
pub fn whiteboard_add_text(
    state: State<SharedWhiteboardState>,
    board_id: String,
    text: String,
    x: f64,
    y: f64,
    font_size: f64,
    color: String,
) -> Result<BoardText, String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    load_board(&conn, &board_id)?;
    let id = Uuid::new_v4().to_string();
    let z_index = next_z_index(&conn, &board_id);
    let created_at = now_ms();
    conn.execute(
        "INSERT INTO board_texts (id, board_id, text, color, font_size, x, y, w, h, z_index, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,240,32,?8,?9)",
        params![id, board_id, text, color, font_size.max(6.0), x, y, z_index, created_at],
    )
    .map_err(|e| e.to_string())?;
    touch_board(&conn, &board_id);
    Ok(BoardText {
        id,
        board_id,
        text,
        color,
        font_size: font_size.max(6.0),
        x,
        y,
        w: 240.0,
        h: 32.0,
        z_index,
        created_at,
    })
}

#[tauri::command]
pub fn whiteboard_update_texts_batch(
    state: State<SharedWhiteboardState>,
    board_id: String,
    items: Vec<TextTransform>,
) -> Result<(), String> {
    let user_data = state_user_data(&state)?;
    let mut conn = open_db(&user_data)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for item in &items {
        tx.execute(
            "UPDATE board_texts SET text = ?1, color = ?2, font_size = ?3,
                    x = ?4, y = ?5, w = ?6, h = ?7, z_index = ?8
             WHERE id = ?9 AND board_id = ?10",
            params![
                item.text,
                item.color,
                item.font_size.max(6.0),
                item.x,
                item.y,
                item.w.max(16.0),
                item.h.max(8.0),
                item.z_index,
                item.id,
                board_id
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    touch_board(&conn, &board_id);
    Ok(())
}

#[tauri::command]
pub fn whiteboard_delete_texts(
    state: State<SharedWhiteboardState>,
    board_id: String,
    ids: Vec<String>,
) -> Result<(), String> {
    let user_data = state_user_data(&state)?;
    let conn = open_db(&user_data)?;
    for id in &ids {
        conn.execute(
            "DELETE FROM board_texts WHERE id = ?1 AND board_id = ?2",
            params![id, board_id],
        )
        .map_err(|e| e.to_string())?;
    }
    touch_board(&conn, &board_id);
    Ok(())
}
