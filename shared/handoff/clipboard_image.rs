use anyhow::{Context, Result, ensure};

use super::VerifiedClipboardTextWrite;

const LENGTH_HEADER_BYTES: usize = 8;

/// Bounded, verified combined PNG/text offer. X11 and other unsupported backends refuse before
/// touching the clipboard; Wayland remains outcome-unknown because it exposes no owner identity.
pub fn copy_png_and_text_to_clipboard_verified_until(
    png: &[u8],
    text: &str,
    deadline: std::time::Instant,
) -> VerifiedClipboardTextWrite {
    if std::time::Instant::now() >= deadline {
        return VerifiedClipboardTextWrite::Unavailable;
    }

    #[cfg(target_os = "macos")]
    {
        if payload_refusal(png, text).is_some() || std::time::Instant::now() >= deadline {
            return VerifiedClipboardTextWrite::Unavailable;
        }
        let Some(input) = encode_owner_input(png, text) else {
            return VerifiedClipboardTextWrite::Unavailable;
        };
        super::run_bounded_native_clipboard_owner(
            &["--internal-native-clipboard-text-owner", "--png-and-text"],
            input,
            deadline,
        )
    }
    #[cfg(target_os = "linux")]
    {
        match crate::capture::desktop::linux::clipboard::set_png_and_text_verified_until(
            png, text, deadline,
        ) {
            crate::capture::desktop::linux::clipboard::VerifiedTextWrite::Applied => {
                VerifiedClipboardTextWrite::Applied
            }
            crate::capture::desktop::linux::clipboard::VerifiedTextWrite::Unavailable => {
                VerifiedClipboardTextWrite::Unavailable
            }
            crate::capture::desktop::linux::clipboard::VerifiedTextWrite::OutcomeUnknown => {
                VerifiedClipboardTextWrite::OutcomeUnknown
            }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (png, text);
        VerifiedClipboardTextWrite::Unavailable
    }
}

fn payload_refusal(png: &[u8], text: &str) -> Option<&'static str> {
    crate::capture::desktop::workflow::native_host::clipboard_png_refusal(png)
        .or_else(|| crate::capture::desktop::workflow::native_host::clipboard_text_refusal(text))
}

fn encode_owner_input(png: &[u8], text: &str) -> Option<Vec<u8>> {
    let png_len = u32::try_from(png.len()).ok()?;
    let text_bytes = text.as_bytes();
    let text_len = u32::try_from(text_bytes.len()).ok()?;
    let capacity = LENGTH_HEADER_BYTES
        .checked_add(png.len())?
        .checked_add(text_bytes.len())?;
    let mut input = Vec::with_capacity(capacity);
    input.extend_from_slice(&png_len.to_be_bytes());
    input.extend_from_slice(&text_len.to_be_bytes());
    input.extend_from_slice(png);
    input.extend_from_slice(text_bytes);
    Some(input)
}

fn parse_owner_input(input: &[u8]) -> Result<(&[u8], &str)> {
    use crate::capture::desktop::workflow::native_host::{MAX_PNG_BYTES, MAX_UTF8_TEXT_BYTES};

    ensure!(
        input.len() >= LENGTH_HEADER_BYTES,
        "Incomplete PNG/text clipboard header"
    );
    let png_len = u32::from_be_bytes(input[..4].try_into().unwrap()) as usize;
    let text_len = u32::from_be_bytes(input[4..8].try_into().unwrap()) as usize;
    ensure!(
        png_len <= MAX_PNG_BYTES,
        "PNG clipboard payload exceeds limit"
    );
    ensure!(
        text_len <= MAX_UTF8_TEXT_BYTES,
        "Text clipboard payload exceeds limit"
    );
    let expected_len = LENGTH_HEADER_BYTES
        .checked_add(png_len)
        .and_then(|len| len.checked_add(text_len))
        .context("PNG/text clipboard payload length overflow")?;
    ensure!(
        input.len() == expected_len,
        "Incomplete or trailing PNG/text clipboard data"
    );
    let png_end = LENGTH_HEADER_BYTES + png_len;
    let png = &input[LENGTH_HEADER_BYTES..png_end];
    let text =
        std::str::from_utf8(&input[png_end..]).context("Clipboard text is not valid UTF-8")?;
    ensure!(
        payload_refusal(png, text).is_none(),
        "Invalid PNG/text clipboard payload"
    );
    Ok((png, text))
}

/// Private AppKit child mode. The complete bounded frame is validated before the first pasteboard
/// operation; the caller owns the deadline and kills/reaps this one-shot child on timeout.
#[cfg(target_os = "macos")]
pub(crate) fn run_native_clipboard_png_text_owner() -> Result<()> {
    use crate::capture::desktop::workflow::native_host::{MAX_PNG_BYTES, MAX_UTF8_TEXT_BYTES};
    use std::io::Read as _;

    let max_input = LENGTH_HEADER_BYTES + MAX_PNG_BYTES + MAX_UTF8_TEXT_BYTES;
    let mut input = Vec::new();
    std::io::stdin()
        .take(max_input as u64 + 1)
        .read_to_end(&mut input)?;
    ensure!(
        input.len() <= max_input,
        "PNG/text clipboard payload exceeds limit"
    );
    let (png, text) = parse_owner_input(&input)?;
    let result = super::copy_png_and_text_verified_local(png, text);
    match result {
        VerifiedClipboardTextWrite::Applied => println!("APPLIED"),
        VerifiedClipboardTextWrite::Unavailable => println!("UNAVAILABLE"),
        VerifiedClipboardTextWrite::OutcomeUnknown => println!("UNKNOWN"),
    }
    std::io::Write::flush(&mut std::io::stdout())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::desktop::workflow::native_host::{MAX_PNG_BYTES, MAX_UTF8_TEXT_BYTES};

    fn valid_png() -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(&[1, 2, 3, 255])
                .unwrap();
        }
        bytes
    }

    #[test]
    fn native_owner_frame_round_trips_exact_png_and_utf8_text() {
        let png = valid_png();
        let input = encode_owner_input(&png, "synthetic summary").unwrap();
        let (actual_png, actual_text) = parse_owner_input(&input).unwrap();
        assert_eq!(actual_png, png);
        assert_eq!(actual_text, "synthetic summary");
    }

    #[test]
    fn native_owner_frame_rejects_incomplete_trailing_invalid_utf8_and_nul_before_effect() {
        let mut input = encode_owner_input(&valid_png(), "text").unwrap();
        assert!(parse_owner_input(&input[..7]).is_err());
        input.push(0);
        assert!(parse_owner_input(&input).is_err());

        let png = valid_png();
        let mut invalid_utf8 = Vec::new();
        invalid_utf8.extend_from_slice(&(png.len() as u32).to_be_bytes());
        invalid_utf8.extend_from_slice(&1u32.to_be_bytes());
        invalid_utf8.extend_from_slice(&png);
        invalid_utf8.push(0xff);
        assert!(parse_owner_input(&invalid_utf8).is_err());

        let nul_text = encode_owner_input(&png, "bad\0text").unwrap();
        assert!(
            parse_owner_input(&nul_text).is_err(),
            "NUL text is rejected before effect"
        );
    }

    #[test]
    fn public_preflight_uses_the_privileged_png_and_text_limits() {
        assert!(payload_refusal(b"not a PNG", "text").is_some());
        assert!(payload_refusal(&valid_png(), "bad\0text").is_some());
        assert!(payload_refusal(&valid_png(), &"x".repeat(MAX_UTF8_TEXT_BYTES + 1)).is_some());
        assert!(payload_refusal(&vec![0; MAX_PNG_BYTES + 1], "text").is_some());

        let mut oversized_header = Vec::new();
        oversized_header.extend_from_slice(&((MAX_PNG_BYTES + 1) as u32).to_be_bytes());
        oversized_header.extend_from_slice(&0u32.to_be_bytes());
        assert!(parse_owner_input(&oversized_header).is_err());
        let mut oversized_text_header = Vec::new();
        oversized_text_header.extend_from_slice(&0u32.to_be_bytes());
        oversized_text_header.extend_from_slice(&((MAX_UTF8_TEXT_BYTES + 1) as u32).to_be_bytes());
        assert!(parse_owner_input(&oversized_text_header).is_err());
    }

    #[test]
    fn invalid_public_payload_refuses_before_backend_dispatch() {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(1);
        assert_eq!(
            copy_png_and_text_to_clipboard_verified_until(b"not png", "summary", deadline),
            VerifiedClipboardTextWrite::Unavailable,
        );
        assert_eq!(
            copy_png_and_text_to_clipboard_verified_until(&valid_png(), "bad\0text", deadline),
            VerifiedClipboardTextWrite::Unavailable,
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn mac_applied_receipt_requires_one_stable_offer_and_exact_png_and_text_readback() {
        assert!(super::super::pasteboard_write_confirmed(5, 6, 6, true));
        assert!(!super::super::pasteboard_write_confirmed(5, 5, 5, true));
        assert!(!super::super::pasteboard_write_confirmed(5, 6, 7, true));
        assert!(!super::super::pasteboard_write_confirmed(5, 6, 6, false));
    }
}
