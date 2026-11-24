/// The label of the paste shortcut, for hints (`⌥⇧V`, or `Alt+Shift+V`, unless changed; "the
/// paste shortcut" while it's off).
pub fn paste_label() -> String {
    let label = PASTE_LABEL
        .lock()
        .ok()
        .and_then(|label| label.clone())
        .unwrap_or_else(|| ShortcutConfig::default_paste().label);
    if label.is_empty() {
        "the paste shortcut".to_owned()
    } else {
        label
    }
}

static PASTE_LABEL: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn note_paste_label(label: &str) {
    if let Ok(mut slot) = PASTE_LABEL.lock() {
        *slot = Some(label.to_owned());
    }
}

// MARK: Recording a shortcut

/// A key combination pressed in the recorder.
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pressed {
    pub key_code: u32,
    /// Carbon modifier bits (⌘ 1<<8, ⇧ 1<<9, ⌥ 1<<11, ⌃ 1<<12).
    pub modifiers: u32,
    /// The key as the active layout types it, without modifiers ("r", "5", "/").
    #[serde(default)]
    pub key: String,
    /// macOS has this combination as one of its own shortcuts (Keyboard Shortcuts settings).
    #[serde(default)]
    pub reserved: bool,
}

impl Pressed {
    /// Delete or forward delete with no modifier, which turns a shortcut off.
    pub fn is_delete(&self) -> bool {
        let modifiers = self.modifiers
            & (CARBON_CMD_KEY | CARBON_CONTROL_KEY | CARBON_OPTION_KEY | CARBON_SHIFT_KEY);
        modifiers == 0 && DELETE_KEYS.contains(&self.key_code)
    }
}

/// Windows virtual keys (Linux stores shortcuts the same way): Backspace, Delete.
#[cfg(not(target_os = "macos"))]
const DELETE_KEYS: [u32; 2] = [0x08, 0x2E];

/// `kVK_Delete`, `kVK_ForwardDelete`.
#[cfg(target_os = "macos")]
const DELETE_KEYS: [u32; 2] = [51, 117];

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Rejection {
    /// Only ⇧, or no modifiers except for Linux's dedicated Copilot key.
    NoModifier,
    /// A key Apparent can't name or that the recorder uses (Esc).
    UnsupportedKey,
    /// macOS or every app already uses it.
    Reserved(String),
    /// Apparent's other shortcut.
    Taken(ShortcutKind),
    /// `RegisterEventHotKey` refused it.
    Refused,
}

impl Rejection {
    pub fn message(&self) -> String {
        match self {
            Self::NoModifier if cfg!(target_os = "windows") => {
                "Hold Ctrl, Alt or Win with the key.".to_owned()
            }
            Self::NoModifier if cfg!(target_os = "linux") => {
                "Hold Ctrl, Alt or Super with the key.".to_owned()
            }
            Self::NoModifier => "Hold ⌘, ⌥ or ⌃ with the key.".to_owned(),
            Self::UnsupportedKey => "Apparent could not identify that key. Try again, or choose a letter or number.".to_owned(),
            Self::Reserved(label) if cfg!(not(target_os = "macos")) => {
                let system = if cfg!(target_os = "windows") {
                    "Windows"
                } else {
                    "Your desktop"
                };
                if label.starts_with("Ctrl+")
                    && !label.contains("Alt+")
                    && !label.contains("Win+")
                    && !label.contains("Super+")
                {
                    format!("Apps use {label}. Add Alt.")
                } else {
                    format!("{system} uses {label}.")
                }
            }
            Self::Reserved(label) if label.starts_with('⌘') && !label.contains(['⌃', '⌥']) => {
                format!("Apps use {label}. Add ⌥ or ⌃.")
            }
            Self::Reserved(label) => format!("macOS uses {label}."),
            Self::Taken(kind) => format!("{} already uses this.", kind.name()),
            Self::Refused => "Another app has this shortcut.".to_owned(),
        }
    }
}

/// Virtual-key codes (Linux stores shortcuts as them too): F1–F16, then the keys named rather
/// than typed.
#[cfg(not(target_os = "macos"))]
const FUNCTION_KEYS: [(u32, &str); 16] = [
    (0x70, "F1"),
    (0x71, "F2"),
    (0x72, "F3"),
    (0x73, "F4"),
    (0x74, "F5"),
    (0x75, "F6"),
    (0x76, "F7"),
    (0x77, "F8"),
    (0x78, "F9"),
    (0x79, "F10"),
    (0x7A, "F11"),
    (0x7B, "F12"),
    (0x7C, "F13"),
    (0x7D, "F14"),
    (0x7E, "F15"),
    (0x7F, "F16"),
];

#[cfg(not(target_os = "macos"))]
const NAMED_KEYS: [(u32, &str); 8] = [
    (0x20, "Space"),
    (0x0D, "Enter"),
    (0x09, "Tab"),
    (0x08, "Backspace"),
    (0x25, "Left"),
    (0x27, "Right"),
    (0x28, "Down"),
    (0x26, "Up"),
];

#[cfg(not(target_os = "macos"))]
const KEY_ESCAPE: u32 = 0x1B;

/// macOS virtual key codes (`kVK_*`).
#[cfg(target_os = "macos")]
const FUNCTION_KEYS: [(u32, &str); 16] = [
    (122, "F1"),
    (120, "F2"),
    (99, "F3"),
    (118, "F4"),
    (96, "F5"),
    (97, "F6"),
    (98, "F7"),
    (100, "F8"),
    (101, "F9"),
    (109, "F10"),
    (103, "F11"),
    (111, "F12"),
    (105, "F13"),
    (107, "F14"),
    (113, "F15"),
    (106, "F16"),
];

#[cfg(target_os = "macos")]
const NAMED_KEYS: [(u32, &str); 8] = [
    (49, "Space"),
    (36, "↩"),
    (48, "⇥"),
    (51, "⌫"),
    (123, "←"),
    (124, "→"),
    (125, "↓"),
    (126, "↑"),
];

#[cfg(target_os = "macos")]
const KEY_ESCAPE: u32 = 53;

/// The name a key is shown with: a function key, a named key, or the typed character in capitals.
pub fn key_label(key_code: u32, typed: &str) -> Option<String> {
    #[cfg(target_os = "linux")]
    if key_code == 95 { return Some("Fn".to_owned()); }
    #[cfg(target_os = "macos")]
    if matches!(key_code, 58 | 61) { return Some("Option".to_owned()); }
    #[cfg(target_os = "macos")]
    if key_code == MACOS_FN_KEY_CODE {
        return Some("Fn".to_owned());
    }
    #[cfg(target_os = "linux")]
    if key_code == 201 {
        return Some("Copilot".to_owned());
    }
    if let Some((_, name)) = FUNCTION_KEYS
        .iter()
        .chain(NAMED_KEYS.iter())
        .find(|(code, _)| *code == key_code)
    {
        return Some((*name).to_owned());
    }
    if key_code == KEY_ESCAPE {
        return None;
    }
    let mut chars = typed
        .chars()
        .filter(|c| !c.is_control() && !c.is_whitespace());
    let ch = chars.next()?;
    if chars.next().is_some() {
        return None;
    }
    Some(ch.to_uppercase().collect())
}

fn is_function_key(key_code: u32) -> bool {
    FUNCTION_KEYS.iter().any(|(code, _)| *code == key_code)
}

/// Combinations macOS or nearly every app keeps for itself, as (Carbon modifiers, key label).
/// Turned-off system shortcuts are allowed; `Pressed::reserved` covers the enabled ones,
/// including any Kit set up himself.
fn reserved(modifiers: u32, key: &str) -> bool {
    const CMD: u32 = CARBON_CMD_KEY;
    const SHIFT: u32 = CARBON_SHIFT_KEY;
    const OPT: u32 = CARBON_OPTION_KEY;
    const CTRL: u32 = CARBON_CONTROL_KEY;
    if cfg!(target_os = "windows") {
        // Win (⌘'s bit) with a key, alone or with Shift, is Windows' own (Win+R, Win+Shift+S…);
        // Ctrl with one key is an app's (Ctrl+C, Ctrl+Shift+T…).
        return modifiers & CMD != 0 && modifiers & (CTRL | OPT) == 0
            || modifiers & (CTRL | CMD | OPT) == CTRL
            || [
                (OPT, "Tab"),
                (OPT | SHIFT, "Tab"),
                (OPT, "F4"),
                (OPT, "Space"),
                (CTRL | OPT, "Tab"),
                (CTRL | CMD | OPT, "Space"),
            ]
            .contains(&(modifiers, key));
    }
    if cfg!(target_os = "linux") {
        // Super (⌘'s bit) with a key, alone or with Shift, is the desktop's (Super+A, the
        // workspaces…); Ctrl with one key is an app's. Then Alt+Tab, Alt+F2, Ctrl+Alt+T…
        // Copilot has no ordinary application shortcut reservation. Actual
        // compositor conflicts are still checked by the native binder.
        if key == "Copilot" { return false; }
        return modifiers & CMD != 0 && modifiers & (CTRL | OPT) == 0
            || modifiers & (CTRL | CMD | OPT) == CTRL
            || [
                (OPT, "Tab"),
                (OPT | SHIFT, "Tab"),
                (OPT, "F2"),
                (OPT, "F4"),
                (OPT, "Space"),
                (OPT, "F7"),
                (OPT, "F8"),
                (CTRL | OPT, "Tab"),
                (CTRL | OPT, "T"),
                (CTRL | OPT, "Left"),
                (CTRL | OPT, "Right"),
                (CTRL | OPT, "Up"),
                (CTRL | OPT, "Down"),
            ]
            .contains(&(modifiers, key));
    }
    // ⌘ with one key is an app's menu shortcut somewhere (⌘Q, ⌘W, ⌘R…).
    if modifiers == CMD || modifiers == CMD | SHIFT && ["3", "4", "5", "6", "Q", "/"].contains(&key)
    {
        return true;
    }
    [
        (CTRL | CMD, "Q"),
        (CTRL | CMD, "F"),
        (CTRL | CMD, "Space"),
        (CTRL | CMD, "D"),
        (CTRL, "Space"),
        (CTRL | OPT, "Space"),
        (OPT | CMD, "Space"),
        (CMD | SHIFT, "Space"),
        (OPT | CMD, "D"),
        (OPT | CMD, "H"),
        (OPT | CMD, "M"),
        (OPT | CMD, "W"),
        (CMD | SHIFT, "⇥"),
        (CTRL, "⇥"),
    ]
    .contains(&(modifiers, key))
}

/// Checks a pressed combination for `kind` and names it. `other` is Apparent's other shortcut.
pub fn validate(
    kind: ShortcutKind,
    pressed: &Pressed,
    other: &ShortcutConfig,
) -> Result<ShortcutConfig, Rejection> {
    let modifiers = pressed.modifiers
        & (CARBON_CMD_KEY | CARBON_CONTROL_KEY | CARBON_OPTION_KEY | CARBON_SHIFT_KEY);
    let key = key_label(pressed.key_code, &pressed.key).ok_or(Rejection::UnsupportedKey)?;
    let strong = modifiers & (CARBON_CMD_KEY | CARBON_CONTROL_KEY | CARBON_OPTION_KEY) != 0;
    let copilot = cfg!(target_os = "linux") && pressed.key_code == 201;
    let fn_key = cfg!(target_os = "macos") && matches!(pressed.key_code, MACOS_FN_KEY_CODE | 58 | 61)
        || cfg!(target_os = "linux") && pressed.key_code == 95;
    let fn_only = fn_key && kind == ShortcutKind::Record && modifiers == 0;
    if fn_key && !fn_only { return Err(Rejection::UnsupportedKey); }
    if pressed.reserved || reserved(modifiers, &key) {
        return Err(Rejection::Reserved(format!("{}{key}", modifier_symbols(modifiers))));
    }
    if !strong && !is_function_key(pressed.key_code) && !copilot && !fn_only && modifiers != 0 {
        return Err(Rejection::NoModifier);
    }
    let label = format!("{}{key}", modifier_symbols(modifiers));
    let cfg = ShortcutConfig {
        key_code: pressed.key_code,
        carbon_modifiers: modifiers,
        label,
    };
    let other_kind = match kind {
        ShortcutKind::Record => ShortcutKind::Paste,
        ShortcutKind::Paste => ShortcutKind::Record,
    };
    if cfg.key_code == other.key_code && cfg.carbon_modifiers == other.carbon_modifiers
        || cfg.label == other.label
    {
        return Err(Rejection::Taken(other_kind));
    }
    Ok(if cfg.is_default_for(kind) {
        kind.default_config()
    } else {
        cfg
    })
}

// MARK: Launch at login (SMAppService on macOS 13+, the Run key on Windows)

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoginItem {
    Off,
    On,
    /// Registered, waiting for the user in System Settings › Login Items (on Windows: switched
    /// off in Settings › Apps › Startup).
    NeedsApproval,
    /// Not running from Apparent.app (a development build).
    Unavailable,
}

/// Apply an explicit file preference to OS registration, without fighting approval switches.
fn reconcile_login_item_in(
    path: &Path,
    observe: impl FnOnce() -> (LoginItem, bool),
    mut set: impl FnMut(bool) -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    // OS status can perform synchronous ServiceManagement IPC. With no
    // explicit preference there is nothing to reconcile; never acquire it.
    if crate::shared::handoff::load_config_from(path).launch_at_login.is_none() {
        return Ok(());
    }
    let (current, stale_command) = observe();
    // Preserve the original fresh preference read after OS observation: a user
    // can edit or remove it while a native service is blocked.
    let Some(wanted) = crate::shared::handoff::load_config_from(path).launch_at_login else {
        return Ok(());
    };
    if current == LoginItem::Unavailable || current == LoginItem::NeedsApproval && wanted {
        return Ok(());
    }
    if wanted != (current == LoginItem::On) || wanted && stale_command {
        set(wanted)?;
    }
    Ok(())
}

/// Reconcile at launch and on Settings refresh, so agent edits take effect without restarting.
pub fn reconcile_login_item() {
    if option_env!("APPARENT_PREVIEW_BUILD").is_some() {
        return;
    }
    if let Err(error) = reconcile_login_item_in(
        &crate::shared::handoff::default_config_path(), || (login_item(), login_command_stale()), set_login_item,
    ) {
        crate::capture::engine::runtime::apparent_log(format!("Launch at login: {error:#}"));
    }
}

#[cfg(target_os = "macos")]
fn login_command_stale() -> bool { false }
#[cfg(target_os = "linux")]
fn login_command_stale() -> bool { crate::capture::desktop::linux::login::command_stale() }

#[cfg(target_os = "macos")]
pub use self::login::{login_item, open_login_items_settings, set_login_item};

#[cfg(target_os = "macos")]
mod login {
    use super::LoginItem;

    #[link(name = "ServiceManagement", kind = "framework")]
    unsafe extern "C" {}

    fn main_app_service() -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
        // Shared config preferences cannot register or remove a production login item.
        if option_env!("APPARENT_PREVIEW_BUILD").is_some() {
            return None;
        }
        use objc2::runtime::{AnyClass, AnyObject};
        let class = AnyClass::get(c"SMAppService")?;
        let exe = std::env::current_exe().ok()?;
        // SMAppService registers the bundle this executable is in; outside one it can't.
        exe.ancestors()
            .find(|p| p.extension().is_some_and(|ext| ext == "app"))?;
        unsafe {
            let service: *mut AnyObject = objc2::msg_send![class, mainAppService];
            objc2::rc::Retained::retain(service)
        }
    }

    fn login_item_from_status(status: isize) -> LoginItem {
        match status {
            1 => LoginItem::On,
            2 => LoginItem::NeedsApproval,
            _ => LoginItem::Off,
        }
    }

    pub fn login_item() -> LoginItem {
        let Some(service) = main_app_service() else {
            return LoginItem::Unavailable;
        };
        let status: isize = unsafe { objc2::msg_send![&*service, status] };
        login_item_from_status(status)
    }

    pub fn set_login_item(on: bool) -> anyhow::Result<()> {
        use objc2::runtime::Bool;
        use objc2_foundation::NSError;
        let service =
            main_app_service().ok_or_else(|| anyhow::anyhow!("not running from Apparent.app"))?;
        let mut error: Option<objc2::rc::Retained<NSError>> = None;
        let ok: Bool = unsafe {
            if on {
                objc2::msg_send![&*service, registerAndReturnError: &mut error]
            } else {
                objc2::msg_send![&*service, unregisterAndReturnError: &mut error]
            }
        };
        if ok.as_bool() {
            Ok(())
        } else {
            anyhow::bail!(
                "{}",
                error.map_or_else(
                    || "unknown error".to_owned(),
                    |e| e.localizedDescription().to_string()
                )
            )
        }
    }

    pub fn open_login_items_settings() {
        use objc2::runtime::AnyClass;
        if let Some(class) = AnyClass::get(c"SMAppService") {
            let _: () = unsafe { objc2::msg_send![class, openSystemSettingsLoginItems] };
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn login_item_statuses_keep_the_toggle_available() {
            assert_eq!(login_item_from_status(0), LoginItem::Off);
            assert_eq!(login_item_from_status(1), LoginItem::On);
            assert_eq!(login_item_from_status(2), LoginItem::NeedsApproval);
            assert_eq!(login_item_from_status(3), LoginItem::Off);
            assert_eq!(login_item_from_status(99), LoginItem::Off);
        }
    }
}

#[cfg(target_os = "linux")]
pub fn login_item() -> LoginItem {
    match crate::capture::desktop::linux::login::status() {
        (false, _) => LoginItem::Off,
        (true, false) => LoginItem::On,
        (true, true) => LoginItem::NeedsApproval,
    }
}

#[cfg(target_os = "linux")]
pub fn set_login_item(on: bool) -> anyhow::Result<()> {
    crate::capture::desktop::linux::login::set(on)
}

#[cfg(target_os = "linux")]
fn open_login_items_settings() {
    crate::capture::desktop::linux::login::open_startup_settings();
}

// MARK: What the window shows
