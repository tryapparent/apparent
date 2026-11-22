#[cfg(target_os = "linux")]
pub fn desktop_access(activate: bool) -> &'static str {
    use std::time::Duration;
    use zbus::blocking::Proxy;
    use zbus::blocking::connection::Builder;
    use zbus::blocking::proxy::Builder as ProxyBuilder;
    use zbus::proxy::CacheProperties;

    fn readback(activate: bool) -> zbus::Result<bool> {
        let session = Builder::session()?
            .method_timeout(Duration::from_millis(400))
            .build()?;
        let status: Proxy<'_> = ProxyBuilder::new(&session)
            .destination("org.a11y.Bus")?
            .path("/org/a11y/bus")?
            .interface("org.a11y.Status")?
            .cache_properties(CacheProperties::No)
            .build()?;
        if activate && !status.get_property::<bool>("IsEnabled")? {
            status.set_property("IsEnabled", true)?;
        }
        status.get_property("IsEnabled")
    }

    match readback(activate) {
        Ok(true) => "enabled",
        Ok(false) => "disabled",
        Err(_) => "unavailable",
    }
}

#[cfg(target_os = "macos")]
pub fn desktop_access(activate: bool) -> &'static str {
    use core_foundation::{
        base::TCFType,
        boolean::CFBoolean,
        dictionary::{CFDictionary, CFDictionaryRef},
        string::{CFString, CFStringRef},
    };

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> bool;
    }

    let trusted = unsafe {
        if activate {
            let prompt = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
            let options = CFDictionary::from_CFType_pairs(&[(prompt, CFBoolean::true_value())]);
            AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
        } else {
            AXIsProcessTrustedWithOptions(std::ptr::null())
        }
    };
    if trusted {
        "enabled"
    } else {
        "approval_required"
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub fn desktop_access(_activate: bool) -> &'static str {
    "unavailable"
}
