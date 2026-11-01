//! Deliberately literal launch contract: no parsing, normalization or decoded commands.
pub fn valid(url: &str) -> bool {
    url == "apparent://open"
}

pub fn can_present(recording: bool, processing: bool, selecting: bool) -> bool {
    !recording && !processing && !selecting
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_url_opens_the_app() {
        assert!(valid("apparent://open"));
    }

    #[test]
    fn launch_never_presents_over_active_capture_work() {
        assert!(can_present(false, false, false));
        for state in 1..8 {
            assert!(!can_present(state & 1 != 0, state & 2 != 0, state & 4 != 0));
        }
    }

    #[test]
    fn untrusted_variants_are_not_commands() {
        for url in [
            "",
            "apparent:",
            "apparent://",
            "apparent://open/",
            "apparent://OPEN",
            "APPARENT://open",
            "apparent://open?record=true",
            "apparent://open#capture",
            "apparent://record",
            "apparent://open/latest",
            "apparent://user@open",
            "apparent://open:80",
            "apparent://%6fpen",
            " apparent://open",
            "apparent://open\n",
            "apparent://open\0",
            "https://open",
            "file:///tmp/capture",
            "apparent://open?",
            "apparent://open#",
            "apparent://open;sh",
            "apparent://open%00",
            "apparent://оpen",
        ] {
            assert!(!valid(url), "accepted {url:?}");
        }
        assert!(!valid(&format!("apparent://open{}", "x".repeat(1_000_000))));
    }
}
