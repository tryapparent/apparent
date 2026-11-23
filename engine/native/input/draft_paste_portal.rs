use super::{saved_token, save_token};
use anyhow::Result;

pub fn send_paste(shift: bool) -> Result<()> {
    send_paste_checked(shift, false, || Ok(()))
}

pub(crate) fn draft_paste_supported() -> bool {
    saved_token("remote-desktop").is_some()
}

pub(crate) fn send_paste_checked(
    shift: bool,
    require_permission: bool,
    check: impl Fn() -> Result<()>,
) -> Result<()> {
    use ashpd::desktop::PersistMode;
    use ashpd::desktop::remote_desktop::{DeviceType, KeyState, RemoteDesktop};
    const CTRL: i32 = 0xffe3;
    const SHIFT: i32 = 0xffe1;
    const V: i32 = 0x76;
    futures_lite::future::block_on(async move {
        let token = saved_token("remote-desktop");
        anyhow::ensure!(!require_permission || token.is_some(), "Paste permission is not saved");
        let proxy = RemoteDesktop::new().await?;
        let session = proxy.create_session().await?;
        proxy
            .select_devices(
                &session,
                DeviceType::Keyboard.into(),
                token.as_deref(),
                PersistMode::ExplicitlyRevoked,
            )
            .await?;
        let started = proxy.start(&session, None).await?.response();
        let started = match started {
            Ok(started) => started,
            Err(error) => {
                save_token("remote-desktop", None);
                return Err(error.into());
            }
        };
        save_token("remote-desktop", started.restore_token());
        let paste = async {
            check()?;
            let mut keys = vec![CTRL];
            if shift {
                keys.push(SHIFT);
            }
            keys.push(V);
            let mut pressed = Vec::new();
            let mut result = Ok(());
            for key in keys {
                if key == V && let Err(error) = check() {
                    result = Err(error);
                    break;
                }
                if let Err(error) = proxy.notify_keyboard_keysym(&session, key, KeyState::Pressed).await {
                    result = Err(error.into());
                    break;
                }
                pressed.push(key);
            }
            for key in pressed.into_iter().rev() {
                if let Err(error) = proxy.notify_keyboard_keysym(&session, key, KeyState::Released).await
                    && result.is_ok()
                {
                    result = Err(error.into());
                }
            }
            result
        }.await;
        let _ = session.close().await;
        paste
    })
}
