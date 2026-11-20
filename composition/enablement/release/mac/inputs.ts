import { releaseTag } from "../manifest.ts";
import { assertNewVersion } from "./publication/feed.ts";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export function validate(env: NodeJS.ProcessEnv, cargo: string, head: string) {
  assert.equal(env.GITHUB_REPOSITORY, "tryapparent/apparent");
  assert.match(env.CANDIDATE_SHA ?? "", /^[0-9a-f]{40}$/);
  assert.equal(head, env.CANDIDATE_SHA);
  assert.match(
    env.APPARENT_VERSION ?? "",
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  );
  const packageSection = cargo.split(/^\[package\]\s*$/m)[1]?.split(/^\[/m)[0];
  assert.equal(
    packageSection?.match(/^version\s*=\s*"([^"]+)"/m)?.[1],
    env.APPARENT_VERSION,
  );
  assert.equal(
    env.RELEASE_TAG,
    releaseTag(env.RELEASE_CHANNEL!, env.APPARENT_VERSION!, env.CANDIDATE_SHA!),
  );
  assert.equal(env.APPARENT_PREVIEW_NOTARIZE, "true");
}
if (process.argv[1]?.endsWith("/inputs.ts")) {
  if (process.env.APPARENT_SOURCE_ROOT)
    process.chdir(process.env.APPARENT_SOURCE_ROOT);
  validate(
    process.env,
    readFileSync("Cargo.toml", "utf8"),
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  );
  if (process.env.RELEASE_CHANNEL === "main")
    assert(
      existsSync("composition/settings/about/mac-updates.bend"),
      "The admitted source predates Mac Nightly support",
    );
  if (process.env.RELEASE_CHANNEL === "stable") {
    const contents = JSON.parse(
      execFileSync(
        "gh",
        [
          "api",
          "repos/tryapparent/apparent/contents/appcast.xml?ref=preview-mac-feed",
        ],
        { encoding: "utf8", timeout: 60_000 },
      ),
    );
    assertNewVersion(
      Buffer.from(contents.content, "base64").toString("utf8"),
      process.env.APPARENT_VERSION!,
    );
  }
}
