import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { gh, repository, verified } from "./assets.ts";
import { updateFeed } from "./feed.ts";
import { publish } from "./homebrew.ts";

const [command, directory, output] = process.argv.slice(2);
if (command === "cask-publish" && directory && output) {
  publish(directory, readFileSync(output, "utf8"));
} else if (["feed", "cask-prepare"].includes(command) && directory) {
  const { metadata, cask } = await verified(directory);
  if (command === "cask-prepare") {
    assert(output);
    writeFileSync(output, cask);
  } else {
    const endpoint = `repos/${repository}/contents/appcast.xml`;
    const branch = "preview-mac-feed";
    const old = JSON.parse(gh(["api", `${endpoint}?ref=${branch}`]));
    const previous = Buffer.from(old.content, "base64").toString("utf8");
    const next = updateFeed(previous, metadata);
    const target = JSON.parse(
      gh(["api", `repos/${repository}/git/ref/tags/${metadata.tag}`]),
    );
    assert.equal(target.object?.type, "commit");
    assert.equal(target.object.sha, metadata.sourceSha);
    if (next !== previous) {
      const { execFileSync } = await import("node:child_process");
      execFileSync("gh", ["api", "-X", "PUT", endpoint, "--input", "-"], {
        encoding: "utf8",
        timeout: 120_000,
        input: JSON.stringify({
          branch,
          sha: old.sha,
          message: `Publish signed Mac ${metadata.version}`,
          content: Buffer.from(next).toString("base64"),
        }),
      });
    }
    const readback = JSON.parse(gh(["api", `${endpoint}?ref=${branch}`]));
    assert.equal(
      Buffer.from(readback.content, "base64").toString("utf8"),
      next,
    );
  }
} else
  throw Error(
    "Use feed DIRECTORY | cask-prepare DIRECTORY OUTPUT | cask-publish TAP_CHECKOUT CASK_FILE",
  );
