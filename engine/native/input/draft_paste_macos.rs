use anyhow::{Result, ensure};
use core_foundation::base::{CFHash, CFType, CFTypeRef, TCFType};
use core_foundation::string::{CFString, CFStringRef};
use objc2_app_kit::NSWorkspace;
use std::{ffi::c_void, ptr};

type AxElement = *const c_void;
type Event = *mut c_void;

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementCreateApplication(pid: i32) -> AxElement;
    fn AXUIElementSetMessagingTimeout(element: AxElement, seconds: f32) -> i32;
    fn AXUIElementCopyAttributeValue(
        element: AxElement,
        attribute: CFStringRef,
        out: *mut CFTypeRef,
    ) -> i32;
    fn AXUIElementGetTypeID() -> usize;
    fn CGEventCreateKeyboardEvent(source: *const c_void, key: u16, down: bool) -> Event;
    fn CGEventSetFlags(event: Event, flags: u64);
    fn CGEventPostToPid(pid: i32, event: Event);
}

fn attribute(element: AxElement, name: &'static str) -> Option<CFType> {
    let key = CFString::from_static_string(name);
    let mut out = ptr::null();
    let status = unsafe { AXUIElementCopyAttributeValue(element, key.as_concrete_TypeRef(), &mut out) };
    (status == 0 && !out.is_null()).then(|| unsafe { CFType::wrap_under_create_rule(out) })
}

pub(super) fn focused_editor() -> Option<(i32, usize, usize)> {
    let pid = NSWorkspace::sharedWorkspace().frontmostApplication()?.processIdentifier();
    if !crate::capture::ui_process::is_external_app(pid) || !crate::capture::engine::runtime::accessibility_granted() {
        return None;
    }
    let app = unsafe { AXUIElementCreateApplication(pid) };
    if app.is_null() {
        return None;
    }
    let app = unsafe { CFType::wrap_under_create_rule(app) };
    unsafe { AXUIElementSetMessagingTimeout(app.as_CFTypeRef(), 0.1) };
    let window = attribute(app.as_CFTypeRef(), "AXFocusedWindow")?;
    let field = attribute(app.as_CFTypeRef(), "AXFocusedUIElement")?;
    if field.type_of() != unsafe { AXUIElementGetTypeID() } {
        return None;
    }
    let secure = attribute(field.as_CFTypeRef(), "AXSubrole")
        .and_then(|value| value.downcast::<CFString>())
        .is_some_and(|role| role.to_string() == "AXSecureTextField");
    if secure {
        return None;
    }
    attribute(field.as_CFTypeRef(), "AXSelectedTextRange")?;
    Some((pid, unsafe { CFHash(window.as_CFTypeRef()) }, unsafe { CFHash(field.as_CFTypeRef()) }))
}

pub(super) fn paste(pid: i32) -> Result<()> {
    let key = crate::capture::engine::runtime::layout_v_keycode();
    unsafe {
        let down = CGEventCreateKeyboardEvent(ptr::null(), key, true);
        ensure!(!down.is_null(), "Could not create paste key press");
        let down = CFType::wrap_under_create_rule(down);
        let up = CGEventCreateKeyboardEvent(ptr::null(), key, false);
        ensure!(!up.is_null(), "Could not create paste key release");
        let up = CFType::wrap_under_create_rule(up);
        for event in [down, up] {
            let event = event.as_CFTypeRef().cast_mut();
            CGEventSetFlags(event, 1 << 20);
            CGEventPostToPid(pid, event);
        }
    }
    Ok(())
}
