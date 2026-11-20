import assert from "node:assert/strict";
import type { distribution } from "../distribution.ts";
type Metadata = ReturnType<typeof distribution>["metadata"];
function compare(left: string, right: string) {
  const a = left.split(".").map(BigInt),
    b = right.split(".").map(BigInt);
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}
export function latest(feed: string) {
  assert(!/<!DOCTYPE|<!ENTITY/.test(feed), "Unsupported appcast declarations");
  assert.match(feed, /<rss\b[^>]*version="2.0"/);
  assert.match(
    feed,
    /xmlns:sparkle="http:\/\/www.andymatuschak.org\/xml-namespaces\/sparkle"/,
  );
  const item = feed.match(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/)?.[1];
  assert(item, "Existing preview feed has no latest item");
  const version = item.match(
    /<sparkle:shortVersionString>(\d+\.\d+\.\d+)<\/sparkle:shortVersionString>/,
  )?.[1];
  const build = item.match(
    /<sparkle:version>(\d+\.\d+)<\/sparkle:version>/,
  )?.[1];
  assert(version && build, "Invalid latest appcast version/build");
  return { version, build, item };
}
export function assertNewVersion(feed: string, version: string) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert(
    compare(version, latest(feed).version) > 0,
    "Candidate version must exceed the live preview version",
  );
}
export function updateFeed(
  previous: string,
  metadata: Metadata,
  now = new Date(),
) {
  const nightly = metadata.channel === "main";
  const old = !previous && nightly ? null : latest(previous);
  if (old?.version === metadata.version && old.build === metadata.buildNumber) {
    assert(
      old.item.includes(`url="${metadata.zipUrl}"`) &&
        old.item.includes(`sparkle:edSignature="${metadata.edSignature}"`) &&
        old.item.includes(`length="${metadata.length}"`),
      "Existing feed version/build refers to different bytes",
    );
    return previous;
  }
  if (!nightly) assertNewVersion(previous, metadata.version!);
  if (old)
    assert(
      compare(metadata.buildNumber!, old.build) > 0,
      "Candidate build must exceed the live preview build",
    );
  const download = nightly ? `<link>${metadata.dmgUrl}</link>` : "";
  const item = `<item><title>${metadata.version}</title>${download}<pubDate>${now.toUTCString()}</pubDate><sparkle:version>${metadata.buildNumber}</sparkle:version><sparkle:shortVersionString>${metadata.version}</sparkle:shortVersionString><sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion><sparkle:hardwareRequirements>arm64</sparkle:hardwareRequirements><enclosure url="${metadata.zipUrl}" length="${metadata.length}" type="application/octet-stream" sparkle:edSignature="${metadata.edSignature}" /></item>`;
  if (!old)
    return `<?xml version="1.0" encoding="utf-8"?>\n<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>Apparent Nightly</title>\n${item}\n</channel></rss>\n`;
  assert.equal((previous.match(/<channel(?:\s[^>]*)?>/g) ?? []).length, 1);
  assert.equal((previous.match(/<\/channel>/g) ?? []).length, 1);
  return previous.replace(/<item(?:\s[^>]*)?>/, item + "\n<item>");
}
