//! Strict, Record-bound protocol carried by the existing same-user GUI socket.
use serde::{Deserialize, Serialize};

pub(crate) const MAX_SERIALIZED_FRAME_BYTES: usize = 131_072;
pub(crate) const MAX_UTF8_TEXT_BYTES: usize = 21_800;
pub(crate) const MAX_PNG_BYTES: usize = 4_194_304;
pub(crate) const MAX_PNG_DIMENSION: u32 = 4096;
pub(crate) const MAX_PNG_DECODED_BYTES: usize = 67_108_864;
pub(crate) const MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES: usize = 9_000_000;
mod png_text;
pub(crate) use png_text::{clipboard_png_refusal, decode_png_hex};
const LEGACY_MAX_FRAME_BYTES: usize = 4096;

pub(crate) fn clipboard_text_refusal(text: &str) -> Option<&'static str> {
    if text.contains('\0') {
        Some("invalid-text")
    } else if text.len() > MAX_UTF8_TEXT_BYTES {
        Some("too-large")
    } else {
        None
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Request {
    pub(crate) protocol: u8,
    pub(crate) id: String,
    pub(crate) owner: String,
    pub(crate) operation: String,
    pub(crate) deadline: u64,
    #[serde(default)]
    pub(crate) expected: Option<Expected>,
    #[serde(default)]
    pub(crate) observed: Option<Expected>,
    #[serde(default, rename = "permissionId")]
    pub(crate) permission_id: Option<String>,
    #[serde(default)]
    pub(crate) key: Option<String>,
    #[serde(default)]
    pub(crate) modifiers: Option<u32>,
    #[serde(default)]
    pub(crate) shortcut: Option<Shortcut>,
    #[serde(default, deserialize_with = "present_value")]
    pub(crate) rgb: Field<serde_json::Value>,
    #[serde(default, rename = "expectedPenColor")]
    pub(crate) expected_pen_color: Option<ExpectedPenColor>,
    #[serde(default)]
    pub(crate) text: Option<String>,
    #[serde(default, rename = "pngHex")]
    pub(crate) png_hex: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub(crate) enum Field<T> {
    #[default]
    Missing,
    Present(T),
}
fn present_value<'de, D, T>(deserializer: D) -> Result<Field<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Field::Present)
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Expected {
    #[serde(rename = "processEpoch")]
    pub(crate) process_epoch: String,
    pub(crate) revision: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Shortcut {
    pub(crate) key_code: u32,
    pub(crate) modifiers: u32,
    pub(crate) label: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ExpectedPenColor {
    pub(crate) present: bool,
    pub(crate) value: serde_json::Value,
}

#[derive(Clone, Debug)]
pub(crate) enum Operation {
    ReadSnapshot,
    RequestPermission(String),
    OpenSystemSettings(String),
    ValidateRecordShortcut(String, u32),
    SaveRecordShortcut(Shortcut),
    ApplyStrokeColor(Option<[u8; 3]>, ExpectedPenColor),
    ReadStrokeColor,
    WriteClipboardText(String),
    WriteClipboardPngText { png_hex: String, text: String },
}

#[derive(Clone, Debug)]
pub(crate) struct Admitted {
    pub(crate) id: String,
    pub(crate) deadline: u64,
    pub(crate) expected: Option<Expected>,
    pub(crate) operation: Operation,
}

const PERMISSIONS: &[&str] = &[
    "screen-recording",
    "microphone",
    "accessibility",
    "camera",
    "speech-recognition",
];

pub(crate) fn parse(line: &str, now: u64) -> Option<Admitted> {
    if line.len().saturating_add(1) > MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES {
        return None;
    }
    let request: Request = serde_json::from_str(line).ok()?;
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let object = value.as_object()?;
    let fields: &[&str] = match request.operation.as_str() {
        "readSnapshot" | "readStrokeColor" => &["protocol", "id", "owner", "operation", "deadline"],
        "requestPermission" | "openSystemSettings" => &[
            "protocol",
            "id",
            "owner",
            "operation",
            "deadline",
            "expected",
            "permissionId",
        ],
        "validateRecordShortcut" => &[
            "protocol",
            "id",
            "owner",
            "operation",
            "deadline",
            "expected",
            "key",
            "modifiers",
        ],
        "saveRecordShortcut" => &[
            "protocol",
            "id",
            "owner",
            "operation",
            "deadline",
            "expected",
            "shortcut",
        ],
        "applyStrokeColor" => &[
            "protocol",
            "id",
            "owner",
            "operation",
            "deadline",
            "expected",
            "rgb",
            "expectedPenColor",
        ],
        "writeClipboardText" => &[
            "protocol", "id", "owner", "operation", "deadline", "observed", "text",
        ],
        "writeClipboardPngText" => &[
            "protocol", "id", "owner", "operation", "deadline", "observed", "text", "pngHex",
        ],
        _ => return None,
    };
    if object.len() != fields.len() || object.keys().any(|key| !fields.contains(&key.as_str())) {
        return None;
    }
    let max_frame = match request.operation.as_str() {
        "writeClipboardPngText" => MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES,
        "writeClipboardText" => MAX_SERIALIZED_FRAME_BYTES,
        _ => LEGACY_MAX_FRAME_BYTES,
    };
    if line.len().saturating_add(1) > max_frame {
        return None;
    }
    if request.protocol != 1
        || request.owner != "record"
        || request.id.len() > 64
        || request.id.is_empty()
        || !request
            .id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || request.deadline <= now
        || request.deadline > now.saturating_add(3000)
    {
        return None;
    }
    let operation = match request.operation.as_str() {
        "readSnapshot"
            if request.expected.is_none()
                && request.permission_id.is_none()
                && request.key.is_none()
                && request.modifiers.is_none()
                && request.shortcut.is_none()
                && matches!(&request.rgb, Field::Missing)
                && request.expected_pen_color.is_none() =>
        {
            Operation::ReadSnapshot
        }
        "readStrokeColor"
            if request.expected.is_none()
                && request.permission_id.is_none()
                && request.key.is_none()
                && request.modifiers.is_none()
                && request.shortcut.is_none()
                && matches!(&request.rgb, Field::Missing)
                && request.expected_pen_color.is_none() =>
        {
            Operation::ReadStrokeColor
        }
        "writeClipboardText"
            if request.expected.is_none()
                && request.observed.is_some()
                && request.text.is_some()
                && request.permission_id.is_none()
                && request.key.is_none()
                && request.modifiers.is_none()
                && request.shortcut.is_none()
                && matches!(&request.rgb, Field::Missing)
                && request.expected_pen_color.is_none() =>
        {
            Operation::WriteClipboardText(request.text.clone()?)
        }
        "writeClipboardPngText" if request.expected.is_none() && request.observed.is_some()
            && request.text.is_some() && request.png_hex.is_some() => {
            Operation::WriteClipboardPngText { png_hex: request.png_hex.clone()?, text: request.text.clone()? }
        }
        "requestPermission"
            if request.expected.is_some()
                && request
                    .permission_id
                    .as_deref()
                    .is_some_and(valid_permission)
                && request.key.is_none()
                && request.modifiers.is_none()
                && request.shortcut.is_none()
                && matches!(&request.rgb, Field::Missing)
                && request.expected_pen_color.is_none() =>
        {
            Operation::RequestPermission(request.permission_id.clone()?)
        }
        "openSystemSettings"
            if request.expected.is_some()
                && request
                    .permission_id
                    .as_deref()
                    .is_some_and(valid_permission)
                && request.key.is_none()
                && request.modifiers.is_none()
                && request.shortcut.is_none()
                && matches!(&request.rgb, Field::Missing)
                && request.expected_pen_color.is_none() =>
        {
            Operation::OpenSystemSettings(request.permission_id.clone()?)
        }
        "validateRecordShortcut"
            if request.expected.is_some()
                && request.key.as_deref().is_some_and(valid_key)
                && request.modifiers.is_some_and(|value| value <= 0xffff)
                && request.permission_id.is_none()
                && request.shortcut.is_none()
                && matches!(&request.rgb, Field::Missing)
                && request.expected_pen_color.is_none() =>
        {
            Operation::ValidateRecordShortcut(request.key.clone()?, request.modifiers?)
        }
        "saveRecordShortcut"
            if request.expected.is_some()
                && request.shortcut.as_ref().is_some_and(valid_shortcut)
                && request.permission_id.is_none()
                && request.key.is_none()
                && request.modifiers.is_none()
                && matches!(&request.rgb, Field::Missing)
                && request.expected_pen_color.is_none() =>
        {
            Operation::SaveRecordShortcut(request.shortcut.clone()?)
        }
        "applyStrokeColor"
            if request.expected.is_some()
                && request.permission_id.is_none()
                && request.key.is_none()
                && request.modifiers.is_none()
                && request.shortcut.is_none()
                && request
                    .expected_pen_color
                    .as_ref()
                    .is_some_and(valid_legacy)
                && matches!(&request.rgb, Field::Present(value) if valid_rgb(value)) =>
        {
            let Field::Present(value) = &request.rgb else {
                return None;
            };
            Operation::ApplyStrokeColor(parse_rgb(value)?, request.expected_pen_color.clone()?)
        }
        _ => return None,
    };
    let observed = request.expected.as_ref().or(request.observed.as_ref());
    if observed.is_some_and(|expected| {
        expected.process_epoch.is_empty()
            || expected.process_epoch.len() > 64
            || !expected
                .process_epoch
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    }) {
        return None;
    }
    Some(Admitted {
        id: request.id,
        deadline: request.deadline,
        expected: request.expected.or(request.observed),
        operation,
    })
}

impl Admitted {
    pub(crate) fn maximum_frame_bytes(&self) -> usize {
        match self.operation {
            Operation::WriteClipboardPngText { .. } => MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES,
            Operation::WriteClipboardText(_) => MAX_SERIALIZED_FRAME_BYTES,
            _ => LEGACY_MAX_FRAME_BYTES,
        }
    }
}

fn valid_permission(value: &str) -> bool {
    PERMISSIONS.contains(&value)
}
fn valid_key(value: &str) -> bool {
    !value.is_empty() && value.len() <= 16 && value.bytes().all(|b| b.is_ascii_alphanumeric())
}
fn valid_shortcut(value: &Shortcut) -> bool {
    value.key_code <= 255
        && value.modifiers <= 0xffff
        && !value.label.is_empty()
        && value.label.len() <= 32
}
fn valid_legacy(value: &ExpectedPenColor) -> bool {
    value.present || value.value.is_null()
}
fn valid_rgb(value: &serde_json::Value) -> bool {
    value.is_null()
        || value.as_array().is_some_and(|channels| {
            channels.len() == 3
                && channels
                    .iter()
                    .all(|channel| channel.as_u64().is_some_and(|v| v <= 255))
        })
}
fn parse_rgb(value: &serde_json::Value) -> Option<Option<[u8; 3]>> {
    if value.is_null() {
        return Some(None);
    }
    let channels = value.as_array()?;
    Some(Some([
        channels[0].as_u64()? as u8,
        channels[1].as_u64()? as u8,
        channels[2].as_u64()? as u8,
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn clipboard_request(text: &str, observed: serde_json::Value, deadline: u64) -> String {
        serde_json::json!({
            "protocol": 1, "id": "a".repeat(36), "owner": "record",
            "operation": "writeClipboardText", "deadline": deadline,
            "observed": observed, "text": text,
        }).to_string()
    }
    fn req(operation: &str, extra: &str) -> String {
        format!(
            r#"{{"protocol":1,"id":"req-1","owner":"record","operation":"{operation}","deadline":3000{extra}}}"#
        )
    }
    #[test]
    fn protocol_is_versioned_correlated_owner_bound_and_strict() {
        assert!(matches!(
            parse(&req("readSnapshot", ""), 1000).unwrap().operation,
            Operation::ReadSnapshot
        ));
        assert!(matches!(
            parse(&req("readStrokeColor", ""), 1000).unwrap().operation,
            Operation::ReadStrokeColor
        ));
        let pen = req(
            "applyStrokeColor",
            r#", "expected":{"processEpoch":"epoch-a","revision":4},"rgb":[0,0,0],"expectedPenColor":{"present":false,"value":null}"#,
        );
        assert!(matches!(
            parse(&pen, 1000).unwrap().operation,
            Operation::ApplyStrokeColor(Some([0, 0, 0]), _)
        ));
        let legacy = req(
            "applyStrokeColor",
            r#", "expected":{"processEpoch":"epoch-a","revision":4},"rgb":null,"expectedPenColor":{"present":true,"value":null}"#,
        );
        assert!(matches!(
            parse(&legacy, 1000).unwrap().operation,
            Operation::ApplyStrokeColor(None, _)
        ));
        for line in [
            req("readSnapshot", r#","path":"/tmp""#),
            req("readSnapshot", r#","owner":"desktop""#),
            req(
                "readStrokeColor",
                r#","expected":{"processEpoch":"epoch-a","revision":4}"#,
            ),
            req("readStrokeColor", r#","expected":null"#),
            req("readStrokeColor", r#","rgb":null"#),
            req(
                "readStrokeColor",
                r#","expectedPenColor":{"present":false,"value":null}"#,
            ),
            req("readStrokeColor", r#","permissionId":null"#),
            req("readSnapshot", r#","protocol":2"#),
            req(
                "requestPermission",
                r#","expected":{"processEpoch":"e","revision":1},"permissionId":"unknown""#,
            ),
            req(
                "validateRecordShortcut",
                r#","expected":{"processEpoch":"e","revision":1},"key":"a","modifiers":999999"#,
            ),
            req(
                "applyStrokeColor",
                r#", "expected":{"processEpoch":"e","revision":1},"expectedPenColor":{"present":false,"value":null}"#,
            ),
            req(
                "applyStrokeColor",
                r#", "expected":{"processEpoch":"e","revision":1},"rgb":[],"expectedPenColor":{"present":false,"value":null}"#,
            ),
            req(
                "applyStrokeColor",
                r#", "expected":{"processEpoch":"e","revision":1},"rgb":null,"expectedPenColor":{"present":false,"value":"bad"}"#,
            ),
        ] {
            assert!(parse(&line, 1000).is_none(), "{line}");
        }
        assert!(parse(&req("readSnapshot", ""), 3000).is_none());
    }

    #[test]
    fn clipboard_request_accepts_exact_bounded_text_and_observation_only() {
        let observed = serde_json::json!({"processEpoch":"e".repeat(64),"revision":9_007_199_254_740_991u64});
        let text = "quote \" slash \\ tab\t newline\n λ 🖍";
        let line = clipboard_request(text, observed.clone(), 3000);
        let parsed = parse(&line, 1000).unwrap();
        assert!(matches!(parsed.operation, Operation::WriteClipboardText(ref got) if got == text));
        assert_eq!(parsed.expected.as_ref().unwrap().process_epoch, "e".repeat(64));
        assert_eq!(parsed.expected.as_ref().unwrap().revision, 9_007_199_254_740_991);
        assert!(parse(&clipboard_request("bad\0text", observed.clone(), 3000), 1000).is_some());
        for extra in [
            serde_json::json!({"rgb":null}),
            serde_json::json!({"expected": {"processEpoch":"e", "revision":1}}),
            serde_json::json!({"path":"/tmp/file"}),
        ] {
            let mut request: serde_json::Value = serde_json::from_str(&clipboard_request("x", observed.clone(), 3000)).unwrap();
            request.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
            assert!(parse(&request.to_string(), 1000).is_none());
        }
    }

    #[test]
    fn clipboard_wire_limit_includes_worst_case_json_escaping_and_newline() {
        let observed = serde_json::json!({"processEpoch":"e".repeat(64),"revision":9_007_199_254_740_991u64});
        let text = "\u{1}".repeat(MAX_UTF8_TEXT_BYTES);
        let line = clipboard_request(&text, observed.clone(), 3000);
        assert!(line.len() + 1 <= MAX_SERIALIZED_FRAME_BYTES);
        assert!(matches!(parse(&line, 1000).unwrap().operation, Operation::WriteClipboardText(_)));
        assert_eq!(clipboard_text_refusal(&text), None);
        let too_many = "\u{1}".repeat(MAX_UTF8_TEXT_BYTES + 1);
        assert_eq!(clipboard_text_refusal(&too_many), Some("too-large"));
        let line = clipboard_request(&too_many, observed.clone(), 9_007_199_254_740_991);
        assert!(line.len() + 1 > MAX_SERIALIZED_FRAME_BYTES);
        let line = clipboard_request(&"x".repeat(MAX_UTF8_TEXT_BYTES + 1), observed, 3000);
        assert!(line.len() + 1 <= MAX_SERIALIZED_FRAME_BYTES);
        assert!(matches!(parse(&line, 1000).unwrap().operation,
            Operation::WriteClipboardText(ref value) if value == &"x".repeat(MAX_UTF8_TEXT_BYTES + 1)));
        assert!(parse(&"x".repeat(LEGACY_MAX_FRAME_BYTES), 1000).is_none());
    }
}

#[cfg(test)]
mod png_text_protocol_tests {
    use super::*;

    fn request() -> serde_json::Value {
        serde_json::json!({"protocol":1,"id":"png-text","owner":"record",
            "operation":"writeClipboardPngText","deadline":3000,
            "observed":{"processEpoch":"epoch","revision":4},"text":"exact","pngHex":"89504e470d0a1a0a"})
    }

    #[test]
    fn combined_operation_has_fixed_fields_and_observed_cas_without_a_path_selector() {
        let admitted = parse(&request().to_string(), 1000).unwrap();
        assert!(matches!(admitted.operation, Operation::WriteClipboardPngText { ref png_hex, ref text }
            if png_hex == "89504e470d0a1a0a" && text == "exact"));
        assert_eq!(admitted.maximum_frame_bytes(), MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES);
        for (key, value) in [("path", serde_json::json!("/not-allowed")),
            ("expected", serde_json::json!({"processEpoch":"epoch","revision":4})),
            ("mime", serde_json::json!("image/png"))] {
            let mut invalid = request(); invalid[key] = value;
            assert!(parse(&invalid.to_string(), 1000).is_none());
        }
        let mut wrong_owner = request(); wrong_owner["owner"] = "other".into();
        assert!(parse(&wrong_owner.to_string(), 1000).is_none());
        let mut missing = request(); missing.as_object_mut().unwrap().remove("observed");
        assert!(parse(&missing.to_string(), 1000).is_none());
        let mut wrong_operation = request(); wrong_operation["operation"] = "writeClipboardText".into();
        assert!(parse(&wrong_operation.to_string(), 1000).is_none());
    }

    #[test]
    fn combined_maximum_frame_preserves_text_and_legacy_frame_limits() {
        let mut largest = request();
        largest["pngHex"] = "00".repeat(MAX_PNG_BYTES).into();
        largest["text"] = "\u{1}".repeat(MAX_UTF8_TEXT_BYTES).into();
        largest["observed"]["processEpoch"] = "e".repeat(64).into();
        largest["observed"]["revision"] = 9_007_199_254_740_991_u64.into();
        let line = largest.to_string();
        assert!(line.len() + 1 <= MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES);
        assert!(parse(&line, 1000).is_some());
        let too_large = format!("{line}{}", " ".repeat(MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES - line.len()));
        assert!(parse(&too_large, 1000).is_none());
        let mut text = request();
        text.as_object_mut().unwrap().remove("pngHex");
        text["operation"] = "writeClipboardText".into();
        let text = format!("{}{}", text, " ".repeat(MAX_SERIALIZED_FRAME_BYTES));
        assert!(text.len() < MAX_PNG_TEXT_SERIALIZED_FRAME_BYTES);
        assert!(parse(&text, 1000).is_none());
        let read = serde_json::json!({"protocol":1,"id":"read","owner":"record","operation":"readSnapshot","deadline":3000});
        assert!(parse(&format!("{read}{}", " ".repeat(LEGACY_MAX_FRAME_BYTES)), 1000).is_none());
    }
}
