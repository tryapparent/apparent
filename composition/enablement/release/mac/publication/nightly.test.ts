import assert from "node:assert/strict";
import { test } from "node:test";
import { distribution } from "../distribution.ts";
import { appPlist, macProduct } from "../metadata.ts";
import { updateFeed } from "./feed.ts";
import { nightlyDownload } from "../../../../settings/about/download.ts";

const env = { APPARENT_VERSION: "1.2.3" };
test("Nightly feed updates between commits with the same application version", async () => {
  const payload = (source: string, build: string, paired = false) =>
    distribution(
      {
        ...env,
        CANDIDATE_SHA: source,
        RELEASE_CHANNEL: paired ? "main" : "mac-nightly",
        RELEASE_TAG: `${paired ? "linux-main" : "mac-nightly"}-v2-${source}`,
        APPARENT_PREVIEW_BUILD_NUMBER: build,
      },
      "b".repeat(64),
      `sparkle:edSignature="${Buffer.alloc(64).toString("base64")}" length="123"`,
      123,
    );
  const first = payload("a".repeat(40), "1000.1", true);
  const second = payload("c".repeat(40), "1001.1");
  const feed = updateFeed(updateFeed("", first.metadata), second.metadata);
  assert.equal(
    await nightlyDownload(
      async () => new Response(updateFeed("", first.metadata)),
    ),
    first.metadata.dmgUrl,
  );
  assert.equal(first.cask, "");
  assert.equal(updateFeed(feed, second.metadata), feed);
  assert.throws(
    () => updateFeed(feed, first.metadata),
    /Candidate build must exceed/,
  );
  assert.equal(
    await nightlyDownload(async () => new Response(feed)),
    second.metadata.dmgUrl,
  );
  await assert.rejects(
    nightlyDownload(async () => new Response("", { status: 404 })),
  );
  await assert.rejects(
    nightlyDownload(
      async () =>
        new Response(
          feed.replace("github.com/tryapparent", "example.org/tryapparent"),
        ),
    ),
  );
  const stable = appPlist("1.2.3", "1001.1", "key");
  const nightly = appPlist("1.2.3", "1001.1", "key", macProduct("main"));
  assert.match(stable, /apparent\.preview/);
  assert.match(stable, /\/appcast\.xml/);
  assert.match(stable, /<key>CFBundleURLSchemes<\/key>/);
  assert.match(nightly, /apparent\.nightly/);
  assert.match(nightly, /\/nightly\.xml/);
  assert.doesNotMatch(nightly, /<key>CFBundleURLTypes<\/key>/);
});
