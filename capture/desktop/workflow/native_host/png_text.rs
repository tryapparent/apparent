//! Bounded PNG admission for the privileged combined clipboard operation.
use super::{MAX_PNG_BYTES, MAX_PNG_DECODED_BYTES, MAX_PNG_DIMENSION};

pub(crate) fn decode_png_hex(value: &str) -> Result<Vec<u8>, &'static str> {
    if value.len() > MAX_PNG_BYTES * 2 {
        return Err("too-large");
    }
    if value.is_empty() || value.len() % 2 != 0 {
        return Err("invalid-png");
    }
    let digit = |value: u8| match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    };
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            Ok(
                (digit(pair[0]).ok_or("invalid-png")? << 4)
                    | digit(pair[1]).ok_or("invalid-png")?,
            )
        })
        .collect()
}

fn complete_png_container(bytes: &[u8]) -> bool {
    let mut offset = 8usize;
    loop {
        let Some(header) = offset.checked_add(8).and_then(|end| bytes.get(offset..end)) else {
            return false;
        };
        let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
        let Some(end) = offset
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
        else {
            return false;
        };
        if end > bytes.len() {
            return false;
        }
        if &header[4..8] == b"IEND" {
            return length == 0 && end == bytes.len();
        }
        offset = end;
    }
}

pub(crate) fn clipboard_png_refusal(bytes: &[u8]) -> Option<&'static str> {
    if bytes.len() > MAX_PNG_BYTES {
        return Some("too-large");
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || !complete_png_container(bytes) {
        return Some("invalid-png");
    }
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_limits(png::Limits {
        bytes: MAX_PNG_DECODED_BYTES,
    });
    let Ok(mut reader) = decoder.read_info() else {
        return Some("invalid-png");
    };
    let info = reader.info();
    if info.width > MAX_PNG_DIMENSION || info.height > MAX_PNG_DIMENSION {
        return Some("too-large");
    }
    if info.animation_control.is_some() {
        return Some("invalid-png");
    }
    let Some(size) = reader.output_buffer_size() else {
        return Some("too-large");
    };
    if size > MAX_PNG_DECODED_BYTES {
        return Some("too-large");
    }
    let mut output = vec![0; size];
    if reader.next_frame(&mut output).is_err() || reader.finish().is_err() {
        return Some("invalid-png");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .unwrap()
                .write_image_data(rgba)
                .unwrap();
        }
        bytes
    }

    #[test]
    fn admits_complete_static_png_and_rejects_signature_only_corrupt_and_oversize_images() {
        let valid = png(1, 1, &[0, 1, 2, 255]);
        assert_eq!(clipboard_png_refusal(&valid), None);
        let mut trailing = valid.clone();
        trailing.push(0);
        assert_eq!(clipboard_png_refusal(&trailing), Some("invalid-png"));
        assert_eq!(clipboard_png_refusal(&valid[..8]), Some("invalid-png"));
        let mut corrupt = valid.clone();
        let end = corrupt.len() - 1;
        corrupt[end] ^= 1;
        assert_eq!(clipboard_png_refusal(&corrupt), Some("invalid-png"));
        assert_eq!(
            clipboard_png_refusal(&vec![0; MAX_PNG_BYTES + 1]),
            Some("too-large")
        );
        let oversized = png(
            MAX_PNG_DIMENSION + 1,
            1,
            &vec![0; (MAX_PNG_DIMENSION as usize + 1) * 4],
        );
        assert_eq!(clipboard_png_refusal(&oversized), Some("too-large"));
    }

    #[test]
    fn hex_decoder_accepts_only_exact_bounded_lowercase_pairs() {
        assert_eq!(decode_png_hex("00abff"), Ok(vec![0, 171, 255]));
        for invalid in ["", "a", "AB", "00 0", "0g", "é"] {
            assert_eq!(decode_png_hex(invalid), Err("invalid-png"));
        }
        assert_eq!(
            decode_png_hex(&"00".repeat(MAX_PNG_BYTES + 1)),
            Err("too-large")
        );
    }
}
