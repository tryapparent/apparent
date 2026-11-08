//! What Linux lets Apparent use. Nothing asks for the microphone outside a sandbox. On X11 the
//! screen, the pointer and the keys are open to every app. On Wayland the screen goes through
//! the ScreenCast portal (which asks once, when recording starts), and clicks and ⇧ need the
//! input devices (`/dev/input/event*`), normally readable by the `input` group or device ACLs: the
//! Accessibility row stands for that (`crate::capture::desktop::linux::input`).

use std::collections::BTreeMap;

use crate::capture::desktop::settings::onboarding::{Permission, Status};

pub const INPUT_COMMAND: &str = "sudo usermod -aG input \"$USER\"";

/// Native facts only. Presentation and setup guidance belong to the shared UI.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputAccess {
    pub keyboard: bool,
    pub pointer: bool,
    pub login_pending: bool,
    pub restart_required: bool,
}

static INPUT_ACCESS: std::sync::Mutex<Option<InputAccess>> = std::sync::Mutex::new(None);

/// Last background permission refresh. Rendering never performs NSS or device I/O.
pub fn input_access() -> Option<InputAccess> {
    *INPUT_ACCESS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn read_input_access() -> InputAccess {
    if !super::super::wayland_session() {
        return InputAccess {
            keyboard: true,
            pointer: true,
            login_pending: false,
            restart_required: false,
        };
    }
    let access = super::super::interaction::input::access();
    InputAccess {
        keyboard: access.keyboard,
        pointer: access.pointer,
        login_pending: login_pending().unwrap_or(false),
        restart_required: super::super::interaction::input::restart_required(access),
    }
}

// Use the account database and this process's actual groups, never $USER. Lookup failure
// cannot become a pending-login or granted claim. Fixed buffers bound allocation.
fn login_pending() -> Option<bool> {
    let mut user = std::mem::MaybeUninit::<libc::passwd>::uninit();
    let mut group = std::mem::MaybeUninit::<libc::group>::uninit();
    let mut user_buffer = vec![0u8; 16_384];
    let mut group_buffer = vec![0u8; 16_384];
    let mut user_result = std::ptr::null_mut();
    let mut group_result = std::ptr::null_mut();
    // SAFETY: each reentrant lookup receives its correctly sized output and backing buffer;
    // pointers remain live below. Results are read only after successful nonnull return.
    unsafe {
        if libc::getpwuid_r(
            libc::geteuid(),
            user.as_mut_ptr(),
            user_buffer.as_mut_ptr().cast(),
            user_buffer.len(),
            &mut user_result,
        ) != 0
            || user_result.is_null()
        {
            return None;
        }
        if libc::getgrnam_r(
            c"input".as_ptr(),
            group.as_mut_ptr(),
            group_buffer.as_mut_ptr().cast(),
            group_buffer.len(),
            &mut group_result,
        ) != 0
            || group_result.is_null()
        {
            return None;
        }
        let user = user.assume_init();
        if user.pw_name.is_null() {
            return None;
        }
        let gid = group.assume_init().gr_gid;
        let mut configured = vec![0; 1024];
        let mut count = configured.len() as libc::c_int;
        if libc::getgrouplist(
            user.pw_name,
            user.pw_gid,
            configured.as_mut_ptr(),
            &mut count,
        ) < 0
        {
            return None;
        }
        configured.truncate(count as usize);
        let mut current = vec![0; 1024];
        let count = libc::getgroups(current.len() as libc::c_int, current.as_mut_ptr());
        if count < 0 {
            return None;
        }
        current.truncate(count as usize);
        Some(configured.contains(&gid) && libc::getegid() != gid && !current.contains(&gid))
    }
}

pub fn copy_input_command() {
    if let Err(error) = super::super::interaction::clipboard::set_text(INPUT_COMMAND) {
        crate::capture::engine::runtime::apparent_log(format!("Copy input command: {error:#}"));
    }
}

pub fn permissions() -> BTreeMap<Permission, Status> {
    let access = read_input_access();
    *INPUT_ACCESS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(access);
    let input = input_status(access);
    BTreeMap::from([
        (Permission::ScreenRecording, Status::Granted),
        (Permission::Microphone, Status::Granted),
        (Permission::InputMonitoring, Status::Granted),
        (Permission::Accessibility, input),
        (Permission::Camera, Status::Granted),
    ])
}

fn input_status(access: InputAccess) -> Status {
    if access.restart_required || !access.keyboard || !access.pointer {
        Status::Denied
    } else {
        Status::Granted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_input_status_requires_both_current_device_capabilities() {
        for (keyboard, pointer, expected) in [
            (false, false, Status::Denied),
            (true, false, Status::Denied),
            (false, true, Status::Denied),
            (true, true, Status::Granted),
        ] {
            for login_pending in [false, true] {
                for restart_required in [false, true] {
                    assert_eq!(
                        input_status(InputAccess {
                            keyboard,
                            pointer,
                            login_pending,
                            restart_required
                        }),
                        if restart_required {
                            Status::Denied
                        } else {
                            expected
                        }
                    );
                }
            }
        }
    }
}

/// Copies the fixed manual setup command. This never executes it or changes access.
pub fn open_settings(permission: Permission) {
    if permission == Permission::Accessibility {
        copy_input_command();
    }
}
