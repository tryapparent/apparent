import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function verifyZoomNarration(
  binary: string,
  bundle: string,
  env: NodeJS.ProcessEnv,
) {
  const manifest = join(bundle, "apparent.json");
  const original = readFileSync(manifest);
  const data = JSON.parse(original.toString());
  function zoom(query: string) {
    return spawnSync(
      binary,
      ["zoom", bundle, "--at", query, "--span", "0.4", "--frames", "3"],
      {
        env,
        encoding: "utf8",
        timeout: 90000,
      },
    );
  }
  try {
    data.transcript.words = [
      { text: "Été,", t0: 350, t1: 400 },
      { text: "𐐀", t0: 450, t1: 500 },
    ];
    data.transcript.segments = [{ text: "PréÉté 𐐀!", t0: 100, t1: 550 }];
    writeFileSync(manifest, JSON.stringify(data));
    const at = zoom("été\u2003𐐨");
    assert.equal(at.status, 0, at.stderr);
    assert.equal(
      at.stdout,
      [
        join(bundle, "zoom/zoom-250-650.png"),
        "0:00.250 → 0:00.650, 3 frames: #1 0:00.250, #2 0:00.450, #3 0:00.650",
        "Said: “Été, 𐐀”",
        "",
      ].join("\n"),
    );
    delete data.transcript.words;
    writeFileSync(manifest, JSON.stringify(data));
    const segment = zoom("été 𐐨");
    assert.equal(segment.status, 0, segment.stderr);
    assert.equal(
      segment.stdout,
      [
        join(bundle, "zoom/zoom-0-400.png"),
        "0:00.000 → 0:00.400, 3 frames: #1 0:00.000, #2 0:00.200, #3 0:00.400",
        "Said: “PréÉté 𐐀!”",
        "",
      ].join("\n"),
    );
    for (const [query, message] of [
      ["?", "“?” is neither a time nor a phrase in the narration"],
      ["1.01", "0:01.010 is past the end (0:01.000)"],
    ]) {
      const rejected = zoom(query);
      assert.equal(rejected.status, 1);
      assert.equal(rejected.stdout, "");
      assert.ok(rejected.stderr.includes(message), rejected.stderr);
    }
  } finally {
    writeFileSync(manifest, original);
  }
}
