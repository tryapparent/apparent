use super::*;
use std::fs;
use std::io::BufReader;

#[test]
fn writer_preserves_manifest_summary_and_png_bytes_in_a_private_directory() {
    let root = std::env::temp_dir().join(crate::make_bundle_id());
    let original = root.join("original.apparent");
    let rewritten = root.join("rewritten.apparent");
    let (_, bundle, summary) = crate::generate_demo_bundle(Some(original.clone())).unwrap();
    let load = |relative: &str| {
        crate::render::decode_png(BufReader::new(
            fs::File::open(original.join(relative)).unwrap(),
        ))
        .unwrap()
    };
    let frames: Vec<_> = bundle
        .keyframes
        .iter()
        .map(|keyframe| (keyframe.clone(), load(&keyframe.file)))
        .collect();
    assert!(!frames.is_empty(), "exercise the scoped PNG workers too");
    let sheet = load(&bundle.contact_sheet);
    write_bundle_artifacts(&rewritten, &bundle, &frames, &sheet, &summary).unwrap();
    for relative in ["apparent.json", "summary.md", &bundle.contact_sheet]
        .into_iter()
        .chain(
            bundle
                .keyframes
                .iter()
                .map(|keyframe| keyframe.file.as_str()),
        )
    {
        assert_eq!(
            fs::read(rewritten.join(relative)).unwrap(),
            fs::read(original.join(relative)).unwrap(),
            "{relative} changed when written through the compatibility path"
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&rewritten).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
    fs::remove_dir_all(root).unwrap();
}
