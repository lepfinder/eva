/**
 * 辅助功能（Accessibility）能力：判断焦点控件能否粘贴，并合成一次 ⌘V。
 *
 * 剪贴板图片存盘后，用户往往正停在某个输入框里。这里在拿到辅助功能授权的前提下，
 * 直接替他按一次 ⌘V，省掉那一下按键。全部走 C API 直连（不引额外 crate）：
 * 读焦点控件用 HIServices 的 AX 接口，注入按键用 CoreGraphics 的 CGEventPost。
 * 未授权时 CGEventPost 会静默失效，所以调用前必须先过 `is_trusted()`。
 */

use std::ffi::{CStr, CString};
use std::os::raw::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

type AxRef = *mut c_void;
type CfRef = *const c_void;
type CgEventRef = *mut c_void;

const AX_SUCCESS: i32 = 0;
const UTF8_ENCODING: u32 = 0x0800_0100;
/// kVK_ANSI_V
const KEY_V: u16 = 9;
/// kCGEventFlagMaskCommand（0x100000）
const FLAG_COMMAND: u64 = 1 << 20;
/// kCGHIDEventTap
const TAP_HID: u32 = 0;

extern "C" {
    fn AXIsProcessTrusted() -> i8;
    fn AXIsProcessTrustedWithOptions(options: CfRef) -> i8;
    fn AXUIElementCreateSystemWide() -> AxRef;
    fn AXUIElementCreateApplication(pid: i32) -> AxRef;
    fn AXUIElementCopyAttributeValue(element: AxRef, attribute: CfRef, value: *mut CfRef) -> i32;
    fn AXUIElementSetAttributeValue(element: AxRef, attribute: CfRef, value: CfRef) -> i32;

    static kCFBooleanTrue: CfRef;
    /// CFDictionaryCreate 的回调不能传 NULL，否则读取方解引用空回调表崩溃。
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;

    fn CFStringCreateWithCString(alloc: CfRef, c_str: *const i8, encoding: u32) -> CfRef;
    fn CFStringGetCString(string: CfRef, buffer: *mut i8, buffer_size: isize, encoding: u32) -> i8;
    fn CFArrayGetCount(array: CfRef) -> isize;
    fn CFDictionaryCreate(
        alloc: CfRef,
        keys: *const CfRef,
        values: *const CfRef,
        num_values: isize,
        key_callbacks: CfRef,
        value_callbacks: CfRef,
    ) -> CfRef;
    fn CFRelease(cf: CfRef);

    fn CGEventCreateKeyboardEvent(
        source: *mut c_void,
        virtual_key: u16,
        key_down: bool,
    ) -> CgEventRef;
    fn CGEventSetFlags(event: CgEventRef, flags: u64);
    fn CGEventPost(tap: u32, event: CgEventRef);
}

/// EVA 当前是否已被授予辅助功能权限。
pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() != 0 }
}

#[tauri::command]
pub fn accessibility_is_trusted() -> bool {
    is_trusted()
}

/// 触发系统授权框。授权结果不会回调给我们，前端之后自行轮询 `accessibility_is_trusted`。
#[tauri::command]
pub fn accessibility_request_trust() {
    prompt_for_trust()
}

#[tauri::command]
pub fn accessibility_open_settings() {
    open_accessibility_settings()
}

/// 缺权限时主动弹一次系统授权框；同一次运行内只弹一次，之后靠设置页引导。
pub fn prompt_for_trust_once() {
    static PROMPTED: AtomicBool = AtomicBool::new(false);
    if PROMPTED.swap(true, Ordering::Relaxed) {
        return;
    }
    prompt_for_trust();
}

/// 弹出系统的"允许辅助功能"授权框。
pub fn prompt_for_trust() {
    unsafe {
        let key = match cf_string("AXTrustedCheckOptionPrompt") {
            Some(key) => key,
            None => return,
        };
        let keys = [key];
        let values = [kCFBooleanTrue];
        let dict = CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            keys.len() as isize,
            &kCFTypeDictionaryKeyCallBacks as *const c_void,
            &kCFTypeDictionaryValueCallBacks as *const c_void,
        );
        if !dict.is_null() {
            AXIsProcessTrustedWithOptions(dict);
            CFRelease(dict);
        }
        CFRelease(key);
    }
}

/// 打开系统设置的"隐私与安全性 → 辅助功能"面板。
pub fn open_accessibility_settings() {
    const URL: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
    if let Err(e) = open::that(URL) {
        log::warn!("[Accessibility] failed to open settings: {}", e);
    }
}

/// 当前获得焦点的控件是否是一个可输入的文本控件。
///
/// 只认 role + 可用状态，不校验 AXValue 是否可写：终端这类 App 的文本区不接受写值
/// 但能正常响应 ⌘V；最坏情况是粘进只读区域被应用自己忽略。
pub fn focused_field_is_editable() -> bool {
    if let Some(role) = unsafe { system_focused_role() } {
        return editable_role(&role);
    }
    // 系统级读不到，通常是前台 Electron / Chrome 系应用没构建无障碍树，
    // 连整条 systemWide 通道都会超时。改成按 pid 直接找前台应用，逼它建树后读它自己的焦点控件。
    let Some(app) = frontmost_app_element() else {
        log::info!("[Accessibility] frontmost app unavailable, auto-paste skipped");
        return false;
    };
    let err = unsafe { request_ax_tree(app) };
    log::info!("[Accessibility] asked frontmost app for its a11y tree (AXError {err})");
    let role = unsafe {
        let mut role = None;
        for round in 0..AX_TREE_WAIT_ROUNDS {
            std::thread::sleep(Duration::from_millis(AX_TREE_WAIT_MS));
            role = focused_role_of(app);
            if role.is_some() {
                break;
            }
            log::info!(
                "[Accessibility] round {round}: windows = {}, focused window = {}",
                child_count(app, "AXWindows"),
                match copy_attribute(app, "AXFocusedWindow") {
                    Some(window) => {
                        let title = read_string_attribute(window, "AXTitle")
                            .unwrap_or_else(|| "(no title)".to_string());
                        CFRelease(window);
                        title
                    }
                    None => "unreadable".to_string(),
                }
            );
            if round == 1 {
                // 冷启动时第一次请求可能还没被受理，再要求一次
                request_ax_tree(app);
            }
        }
        CFRelease(app);
        role
    };
    match role {
        Some(role) => editable_role(&role),
        None => {
            log::info!("[Accessibility] focus is unreadable, auto-paste skipped");
            false
        }
    }
}

const AX_TREE_WAIT_ROUNDS: u32 = 6;
const AX_TREE_WAIT_MS: u64 = 150;

fn editable_role(role: &str) -> bool {
    log::info!("[Accessibility] focused role = {}", role);
    matches!(role, "AXTextField" | "AXTextArea" | "AXComboBox")
}

/// 合成一次 ⌘V 发给当前前台应用。EVA 自己不是前台，不会粘到自己身上。
pub fn paste_with_cmd_v() {
    unsafe {
        for key_down in [true, false] {
            let event = CGEventCreateKeyboardEvent(ptr::null_mut(), KEY_V, key_down);
            if event.is_null() {
                log::warn!("[Accessibility] CGEventCreateKeyboardEvent returned null");
                return;
            }
            CGEventSetFlags(event, FLAG_COMMAND);
            CGEventPost(TAP_HID, event);
            CFRelease(event as CfRef);
        }
    }
}

/// 系统级焦点控件的角色，即"当前前台 App 里正在接收键盘输入的那个控件"。
unsafe fn system_focused_role() -> Option<String> {
    let system_wide = AXUIElementCreateSystemWide();
    let role = focused_role_of(system_wide as CfRef);
    CFRelease(system_wide as CfRef);
    role
}

/// 前台应用自己的无障碍元素，调用方负责释放。
/// systemWide 在 Chromium 系应用上会整条通道超时，所以直接按 pid 找。
fn frontmost_app_element() -> Option<CfRef> {
    let Some((pid, name, windows)) = frontmost_app() else {
        return None;
    };
    log::info!("[Accessibility] frontmost {name} pid = {pid} windows = {windows}");
    let element = unsafe { AXUIElementCreateApplication(pid) };
    (!element.is_null()).then_some(element as CfRef)
}

/// 前台应用的 pid、名字和窗口数。
/// 窗口数为 0 说明这个应用只是被激活了、并没有 key window，读焦点元素必然 NoValue。
fn frontmost_app() -> Option<(i32, String, usize)> {
    use objc::runtime::Object;
    use objc::{class, msg_send, sel, sel_impl};

    unsafe {
        let workspace: *mut Object = msg_send![class!(NSWorkspace), sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut Object = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let pid: i32 = msg_send![app, processIdentifier];
        let windows: usize = msg_send![app, windowCount];
        let name = {
            let raw: *mut Object = msg_send![app, localizedName];
            if raw.is_null() {
                "unknown".to_string()
            } else {
                let utf8: *const i8 = msg_send![raw, UTF8String];
                if utf8.is_null() {
                    "unknown".to_string()
                } else {
                    CStr::from_ptr(utf8).to_string_lossy().into_owned()
                }
            }
        };
        (pid > 0).then_some((pid, name, windows))
    }
}

/// 要求 App 构建无障碍树。Chromium / Electron 只认这个私有属性，原生 App 会直接报错。
unsafe fn request_ax_tree(app: CfRef) -> i32 {
    let Some(attribute) = cf_string("AXManualAccessibility") else {
        return -1;
    };
    let err = AXUIElementSetAttributeValue(app as AxRef, attribute, kCFBooleanTrue);
    CFRelease(attribute);
    err
}

/// 数组属性有几个元素，读不到返回 -1。
unsafe fn child_count(element: CfRef, name: &str) -> isize {
    let Some(array) = copy_attribute(element, name) else {
        return -1;
    };
    let count = CFArrayGetCount(array);
    CFRelease(array);
    count
}

unsafe fn focused_role_of(element: CfRef) -> Option<String> {
    let focused = copy_attribute(element, "AXFocusedUIElement")?;
    let role = read_string_attribute(focused, "AXRole");
    let enabled = read_bool_attribute(focused, "AXEnabled");
    CFRelease(focused);
    if enabled == Some(false) {
        return None;
    }
    role
}

unsafe fn read_string_attribute(element: CfRef, name: &str) -> Option<String> {
    let value = copy_attribute(element, name)?;
    let mut buffer = [0i8; 128];
    let ok = CFStringGetCString(value, buffer.as_mut_ptr(), buffer.len() as isize, UTF8_ENCODING);
    CFRelease(value);
    if ok == 0 {
        return None;
    }
    CStr::from_ptr(buffer.as_ptr())
        .to_str()
        .ok()
        .map(str::to_string)
}

unsafe fn read_bool_attribute(element: CfRef, name: &str) -> Option<bool> {
    let value = copy_attribute(element, name)?;
    // CFBoolean 是进程内单例，比指针即可判真。
    let result = value == kCFBooleanTrue;
    CFRelease(value);
    Some(result)
}

unsafe fn copy_attribute(element: CfRef, name: &str) -> Option<CfRef> {
    let attribute = cf_string(name)?;
    let mut value: CfRef = ptr::null();
    let err = AXUIElementCopyAttributeValue(element as AxRef, attribute, &mut value);
    CFRelease(attribute);
    if err != AX_SUCCESS || value.is_null() {
        log::info!("[Accessibility] read {name} failed (AXError {err})");
        return None;
    }
    Some(value)
}

unsafe fn cf_string(value: &str) -> Option<CfRef> {
    let c_value = CString::new(value).ok()?;
    let created = CFStringCreateWithCString(ptr::null(), c_value.as_ptr(), UTF8_ENCODING);
    (!created.is_null()).then_some(created)
}
