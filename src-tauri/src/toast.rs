/**
 * 悬浮提示条（HUD toast）
 *
 * 全局快捷键触发时 EVA 所有窗口都是隐藏的，页面内提示用户看不见；系统通知又
 * 需要额外授权。这里用一个常驻的透明置顶窗口，显示时走 objc 的
 * `orderFrontRegardless` 而不是 `Window::show()`——后者最终调
 * `makeKeyAndOrderFront`，会把焦点抢到 EVA，用户随后 ⌘V 就粘到自己应用里去了。
 */

use objc::runtime::Object;
use objc::{msg_send, sel, sel_impl};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

const WINDOW_LABEL: &str = "toast";
const DISPLAY_MS: u64 = 2400;
/// 清空内容到收起窗口的间隔，让 webview 来得及重绘空白
const CLEAR_MS: u64 = 120;

static SEQ: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize)]
pub struct ToastPayload {
    pub seq: u64,
    pub kind: &'static str,
    pub title: String,
    pub body: String,
}

/// 成功态提示条。
pub fn show(app: &AppHandle, title: &str, body: &str) {
    emit_toast(app, "ok", title, body)
}

/// 失败/提醒态提示条。
pub fn warn(app: &AppHandle, title: &str, body: &str) {
    emit_toast(app, "warn", title, body)
}

/// 启动后把窗口亮一下再收起，逼 WKWebView 完成加载并挂载前端。
///
/// 隐藏窗口的 webview 不跑 JS：不预热的话，快捷键触发的第一条提示会落在还没
/// 执行脚本的页面上，窗口亮起来却是空白。窗口本身透明无内容，闪这一下看不出来。
pub fn prewarm(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1000));
        let app_reveal = app.clone();
        let _ = app.run_on_main_thread(move || reveal(&app_reveal));
        std::thread::sleep(Duration::from_millis(600));
        if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
            let _ = win.hide();
        }
    });
}

fn emit_toast(app: &AppHandle, kind: &'static str, title: &str, body: &str) {
    let Some(win) = app.get_webview_window(WINDOW_LABEL) else {
        log::warn!("[Toast] window '{}' is missing", WINDOW_LABEL);
        return;
    };

    let seq = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    log::info!("[Toast] #{} {} | {}", seq, title, body);
    let _ = win.set_ignore_cursor_events(true);
    let payload = ToastPayload {
        seq,
        kind,
        title: title.to_string(),
        body: body.to_string(),
    };

    let app = app.clone();
    std::thread::spawn(move || {
        let app_reveal = app.clone();
        // 先显示再注入内容：窗口 order-out 时 WKWebView 是挂起的，此时 eval
        // 会被丢弃，提示条亮起来却是空白。
        let _ = app.run_on_main_thread(move || {
            reveal(&app_reveal);
            if let Some(win) = app_reveal.get_webview_window(WINDOW_LABEL) {
                push(&win, Some(payload));
            }
        });

        std::thread::sleep(Duration::from_millis(DISPLAY_MS));
        // 期间又弹了新的提示，交给它自己的线程收尾
        if SEQ.load(Ordering::Relaxed) != seq {
            return;
        }
        let Some(w) = app.get_webview_window(WINDOW_LABEL) else {
            return;
        };
        // 收起前先清空：此刻窗口仍可见，webview 一定会执行；
        // 否则下次弹出时会先闪出上一条内容。
        push(&w, None);
        std::thread::sleep(Duration::from_millis(CLEAR_MS));
        if SEQ.load(Ordering::Relaxed) != seq {
            return;
        }
        let _ = w.hide();
    });
}

/// 把内容直接求值进 webview。
///
/// 不用 `emit`：窗口平时是 order-out 的，WKWebView 在隐藏状态下不跑 JS，
/// `listen()` 的注册和事件投递都会丢，导致提示条永远空白。`eval` 由原生侧
/// 注入，窗口一显示就能执行，不依赖任何已注册的监听器。
fn push(win: &WebviewWindow, payload: Option<ToastPayload>) {
    let json = match payload {
        Some(p) => serde_json::to_string(&p).unwrap_or_else(|_| "null".to_string()),
        None => "null".to_string(),
    };
    let js = format!(
        "window.__EVA_TOAST__ = {json}; window.dispatchEvent(new Event('eva-toast'));"
    );
    if let Err(e) = win.eval(&js) {
        log::warn!("[Toast] eval failed: {}", e);
    }
}

fn reveal(app: &AppHandle) {
    let Some(win) = app.get_webview_window(WINDOW_LABEL) else {
        log::warn!("[Toast] reveal: window '{}' disappeared", WINDOW_LABEL);
        return;
    };
    let Ok(ptr) = win.ns_window() else {
        log::warn!("[Toast] reveal: ns_window() unavailable");
        return;
    };
    let ns_window = ptr as *mut Object;
    // CanJoinAllSpaces(1) | FullScreenAuxiliary(256)：后者让提示条也能盖在全屏应用上
    unsafe {
        let behavior: u64 = msg_send![ns_window, collectionBehavior];
        let _: () = msg_send![ns_window, setCollectionBehavior: behavior | 1 | 256];
        let _: () = msg_send![ns_window, orderFrontRegardless];
        let visible: bool = msg_send![ns_window, isVisible];
        let frame: [f64; 4] = msg_send![ns_window, frame];
        let level: isize = msg_send![ns_window, level];
        log::info!(
            "[Toast] revealed visible={} frame=({:.0},{:.0} {:.0}x{:.0}) level={}",
            visible,
            frame[0],
            frame[1],
            frame[2],
            frame[3],
            level
        );
    }

    // 定位要等 order-front 这一轮结束：同一轮里 set_position 会被 AppKit 丢掉
    // （尤其是跨屏移动），提示条会留在上一次的位置。
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(20));
        let _ = app.clone().run_on_main_thread(move || {
            if let Some(win) = app.get_webview_window(WINDOW_LABEL) {
                position_center(&app, &win);
            }
        });
    });
}

/// 水平居中、垂直方向中间略偏下，与微信 HUD 的落点一致。
///
/// 落点取鼠标所在的那块屏：`primary_monitor()` 在多屏机器上未必是用户正在看的
/// 外接屏（这台机器上它返回的是内置屏，提示条会弹到笔记本屏幕上）。
fn position_center(app: &AppHandle, win: &WebviewWindow) {
    let Ok(monitors) = app.available_monitors() else {
        log::warn!("[Toast] position: monitors unavailable");
        return;
    };
    let cursor = app.cursor_position().ok();
    let on_cursor = |m: &tauri::Monitor| match cursor {
        None => false,
        Some(c) => {
            let p = *m.position();
            let s = m.size();
            c.x >= p.x as f64
                && c.x < (p.x + s.width as i32) as f64
                && c.y >= p.y as f64
                && c.y < (p.y + s.height as i32) as f64
        }
    };
    let Some(mon) = monitors
        .iter()
        .find(|m| on_cursor(m))
        .or_else(|| monitors.first())
    else {
        log::warn!("[Toast] position: no monitor");
        return;
    };
    let Ok(wsize) = win.outer_size() else {
        log::warn!("[Toast] position: no outer_size");
        return;
    };
    let mpos = *mon.position();
    let msize = mon.size();
    let x = mpos.x + (msize.width as i32 - wsize.width as i32) / 2;
    let y = mpos.y + (msize.height as f64 * 0.55) as i32 - wsize.height as i32 / 2;
    if let Err(e) = win.set_position(PhysicalPosition::new(x, y)) {
        log::warn!("[Toast] set_position failed: {}", e);
        return;
    }
    match win.outer_position() {
        Ok(p) => log::info!(
            "[Toast] centred on {} ({:.0}x{:.0}) -> want ({},{}) got ({},{})",
            mon.name().map(String::as_str).unwrap_or("?"),
            msize.width as f64,
            msize.height as f64,
            x,
            y,
            p.x,
            p.y
        ),
        Err(e) => log::warn!("[Toast] outer_position failed: {}", e),
    }
}
