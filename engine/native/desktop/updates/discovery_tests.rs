use super::{PublicReleaseLimit, latest_candidate_with, tests::stable_release_fixture, REPO};

#[test]
fn main_channel_orders_publications_across_release_pages() {
    let image = "Apparent-0.3.13-linux-x86_64.AppImage";
    let release = |letter: &str, date: &str| {
        let tag = format!("linux-main-v2-{}", letter.repeat(40));
        let assets: Vec<_> = [image.to_owned(),format!("{image}.sha256")].into_iter().map(|name| {
            serde_json::json!({"browser_download_url":format!("https://github.com/{REPO}/releases/download/{tag}/{name}"),"name":name})
        }).collect();
        serde_json::json!({"tag_name":tag,"prerelease":true,"draft":false,"published_at":date,
            "assets":assets})
    };
    let candidate = latest_candidate_with("main", "x86_64", &|url| {
        if url.ends_with("?per_page=100&page=11") {
            return Ok(serde_json::to_vec(&vec![release("b", "2026-10-29T01:00:00Z")])?);
        }
        if url.contains("/releases?per_page=100&page=") {
            return Ok(serde_json::to_vec(&vec![release("a", "2026-10-28T01:00:00Z"); 100])?);
        }
        assert!(url.ends_with(".sha256"), "stop after the final partial page");
        Ok(format!("{}  {image}", "c".repeat(64)).into_bytes())
    }).unwrap().unwrap();
    assert_eq!(candidate.id, "b".repeat(40));
    let candidate = latest_candidate_with("main", "x86_64", &|url| {
        if url.ends_with("?per_page=100&page=11") {
            return Err(PublicReleaseLimit.into());
        }
        if url.contains("/releases?per_page=100&page=") {
            return Ok(serde_json::to_vec(&vec![release("b", "2026-10-29T01:00:00Z"); 100])?);
        }
        assert!(url.ends_with(".sha256"));
        Ok(format!("{}  {image}", "c".repeat(64)).into_bytes())
    }).unwrap().unwrap();
    assert_eq!(candidate.id, "b".repeat(40));
    assert!(latest_candidate_with("main", "x86_64", &|url| {
        assert!(url.contains("/releases?per_page=100&page="));
        Ok(serde_json::to_vec(&vec![stable_release_fixture("recipient-component", "x86_64"); 100])?)
    }).is_err(), "incomplete history must fail before fetching an asset");
    assert!(latest_candidate_with("stable", "x86_64", &|url| {
        if url.ends_with("?per_page=100&page=11") {
            return Err(PublicReleaseLimit.into());
        }
        assert!(url.contains("/releases?per_page=100&page="));
        Ok(serde_json::to_vec(&vec![stable_release_fixture("recipient-component", "x86_64"); 100])?)
    }).is_err(), "a capped history without a matching candidate must fail");
}
