//! OS-specific window behaviour.

use tauri::WebviewWindow;

/// Keep a window out of the taskbar and Alt+Tab (Windows tool window).
#[cfg(windows)]
pub fn hide_from_alt_tab(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
    };
    if let Ok(h) = window.hwnd() {
        let hwnd = HWND(h.0 as _);
        unsafe {
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let ex = (ex | WS_EX_TOOLWINDOW.0 as isize) & !(WS_EX_APPWINDOW.0 as isize);
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
        }
    }
}

#[cfg(not(windows))]
pub fn hide_from_alt_tab(_window: &WebviewWindow) {}

/// Show without stealing focus from whatever the user is doing.
#[cfg(windows)]
pub fn show_no_activate(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    match window.hwnd() {
        Ok(h) => unsafe {
            let _ = ShowWindow(HWND(h.0 as _), SW_SHOWNOACTIVATE);
        },
        Err(_) => {
            let _ = window.show();
        }
    }
}

#[cfg(not(windows))]
pub fn show_no_activate(window: &WebviewWindow) {
    let _ = window.show();
}

/// Watches the foreground window and reports when it covers the primary
/// monitor. Driven entirely by WinEvent callbacks: no timers, no polling.
#[cfg(windows)]
pub mod fullscreen {
    use std::sync::{
        atomic::{AtomicIsize, Ordering},
        OnceLock,
    };
    use tauri::AppHandle;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MonitorFromWindow, MONITORINFO,
        MONITOR_DEFAULTTONEAREST, MONITOR_DEFAULTTOPRIMARY,
    };
    use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowRect,
        GetWindowThreadProcessId, EVENT_OBJECT_LOCATIONCHANGE, EVENT_SYSTEM_FOREGROUND,
        EVENT_SYSTEM_MOVESIZEEND, OBJID_WINDOW, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
    };

    static APP: OnceLock<AppHandle> = OnceLock::new();
    static LOCATION_HOOK: AtomicIsize = AtomicIsize::new(0);

    /// Must be called on the main thread (it owns the message loop).
    pub fn install(app: &AppHandle) {
        let _ = APP.set(app.clone());
        unsafe {
            for event in [EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MOVESIZEEND] {
                SetWinEventHook(
                    event,
                    event,
                    None,
                    Some(on_event),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                );
            }
            watch_location_of(GetForegroundWindow());
        }
        recheck();
    }

    pub fn recheck() {
        if let Some(app) = APP.get() {
            if let Some(full) = unsafe { foreground_is_fullscreen() } {
                crate::set_fullscreen_hidden(app, full);
            }
        }
    }

    unsafe extern "system" fn on_event(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        id_object: i32,
        _id_child: i32,
        _thread: u32,
        _time: u32,
    ) {
        if event == EVENT_OBJECT_LOCATIONCHANGE
            && (id_object != OBJID_WINDOW.0 || hwnd != GetForegroundWindow())
        {
            return;
        }
        if event == EVENT_SYSTEM_FOREGROUND {
            watch_location_of(hwnd);
        }
        recheck();
    }

    /// Follow size changes of the foreground app only (catches F11 in a
    /// browser), by hooking location changes for just that process.
    unsafe fn watch_location_of(hwnd: HWND) {
        let old = LOCATION_HOOK.swap(0, Ordering::SeqCst);
        if old != 0 {
            let _ = UnhookWinEvent(HWINEVENTHOOK(old as _));
        }
        if hwnd.is_invalid() {
            return;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == std::process::id() {
            return;
        }
        let hook = SetWinEventHook(
            EVENT_OBJECT_LOCATIONCHANGE,
            EVENT_OBJECT_LOCATIONCHANGE,
            None,
            Some(on_event),
            pid,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        LOCATION_HOOK.store(hook.0 as isize, Ordering::SeqCst);
    }

    /// None means "our own window is in front; keep the current state".
    unsafe fn foreground_is_fullscreen() -> Option<bool> {
        let fg = GetForegroundWindow();
        if fg.is_invalid() {
            return Some(false);
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(fg, Some(&mut pid));
        if pid == std::process::id() {
            return None;
        }
        if fg == GetDesktopWindow() || fg == GetShellWindow() {
            return Some(false);
        }
        let mut class = [0u16; 64];
        let len = GetClassNameW(fg, &mut class).max(0) as usize;
        let class = String::from_utf16_lossy(&class[..len]);
        if class == "WorkerW" || class == "Progman" {
            return Some(false);
        }

        let monitor = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromPoint(POINT { x: 0, y: 0 }, MONITOR_DEFAULTTOPRIMARY) {
            return Some(false); // fullscreen on another monitor doesn't cover the deck
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Some(false);
        }
        let mut rect = RECT::default();
        if GetWindowRect(fg, &mut rect).is_err() {
            return Some(false);
        }
        let m = info.rcMonitor;
        Some(rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom)
    }
}
