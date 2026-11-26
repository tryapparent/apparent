#[derive(Clone, serde::Serialize)]
pub(crate) struct SparkleError {
    pub(crate) domain: &'static str,
    pub(crate) code: isize,
}

#[cfg(any(target_os = "macos", test))]
impl SparkleError {
    pub(crate) fn new(domain: &str, code: isize) -> Self {
        let domain = match domain {
            "SUSparkleErrorDomain" => "sparkle",
            "NSURLErrorDomain" => "url_loading",
            "NSCocoaErrorDomain" => "cocoa",
            "NSPOSIXErrorDomain" => "posix",
            _ => "other",
        };
        Self { domain, code }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn download_evidence(error: &objc2_foundation::NSError) -> Option<(SparkleError, Option<SparkleError>)> {
    use objc2_foundation::{NSError, NSUnderlyingErrorKey};

    let domain = error.domain().to_string();
    let code = error.code();
    if !sparkle_error_should_report(&domain, code) {
        return None;
    }
    let native = SparkleError::new(&domain, code);
    let cause = if native.domain == "sparkle" && code == 2001 {
        error.userInfo().objectForKey(unsafe { NSUnderlyingErrorKey })
            .and_then(|cause| cause.downcast::<NSError>().ok())
            .map(|cause| SparkleError::new(&cause.domain().to_string(), cause.code()))
    } else {
        None
    };
    Some((native, cause))
}

#[cfg(any(target_os = "macos", test))]
fn sparkle_error_should_report(domain: &str, code: isize) -> bool {
    use crate::embedded_policy::EmbeddedPolicy;

    const SOURCE: &str = include_str!(concat!(env!("OUT_DIR"), "/sparkle-outcomes.mjs"));
    const ENDPOINT: &str = "sparkle_outcome";
    thread_local! {
        static OUTCOMES: Option<EmbeddedPolicy> =
            EmbeddedPolicy::open("sparkle-outcomes", SOURCE, &[ENDPOINT]).ok();
    }

    let Ok(code) = u32::try_from(code) else {
        return true;
    };
    OUTCOMES.with(|policy| {
        policy
            .as_ref()
            .and_then(|policy| {
                policy
                    .call(ENDPOINT, (domain == "SUSparkleErrorDomain", code))
                    .ok()
            })
            .as_deref()
            != Some("expected")
    })
}

#[cfg(test)]
#[test]
fn sparkle_excludes_expected_update_outcomes_for_its_domain_only() {
    for code in [1001, 1003, 1005, 4007, 4008] {
        assert!(!sparkle_error_should_report("SUSparkleErrorDomain", code));
        assert!(sparkle_error_should_report("NSURLErrorDomain", code));
    }
    for code in [-1009, 1002, 4005] {
        assert!(sparkle_error_should_report("SUSparkleErrorDomain", code));
    }
}
