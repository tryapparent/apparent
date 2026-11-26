import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  bendScratch,
  buildBend,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";
import { assembleHandoffLine, assembleZoom, root } from "./build.ts";
import { traceAdmission } from "./trace.ts";
import { assembleVideo } from "./video.ts";

await bendScratch(async (directory) => {
  await buildBend(
    root,
    "agent",
    directory,
    proofOptions(process.argv.slice(2)),
  );

  assert.deepEqual(traceAdmission(directory), [
    "Disabled",
    "Begin",
    "Disabled",
    "Closed",
    "Disabled",
    "Full",
    "Disabled",
    "Closed",
  ]);

  assembleVideo(directory);
  const videoCheck = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import assert from "node:assert/strict";
import { parsePlan, policy } from "./plan.mjs";
assert.equal(policy.clip_valid(20, 100, 100), true);
assert.equal(policy.clip_valid(100, 100, 100), false);
assert.equal(policy.clip_valid(20, 101, 100), false);
assert.equal(policy.still_valid(99, 100), true);
assert.equal(policy.still_valid(100, 100), false);
assert.equal(policy.scene_frames(6000, 147, 450), 180);
assert.equal(policy.scene_frames(0, 147, 450), 161);
assert.equal(policy.caption_end(30, 33), 31);
assert.equal(policy.sample_time(20, 80, 2, 3), 100);
assert.equal(policy.axis_fits(10, 90, 100), true);
assert.equal(policy.axis_fits(10, 91, 100), false);
assert.equal(policy.axis_fits(0, 0, 100), false);
assert.equal(policy.scene_frames(0, 31, 0), 31);
const scene = { shots: [{ file: "space in name.png", box: [0.25, 0.3, 0.4, 0.4] }], say: ["Here is the evidence."] };
const plan = parsePlan({version: 1, scenes: [scene]}, "/tmp");
assert.equal(plan.scenes[0].shots[0].file, "/tmp/space in name.png");
assert.deepEqual(plan.scenes[0].say, [{text: "Here is the evidence."}]);
const timed = { ...scene, say: [{text: "Now.", startMs: 1250}] };
assert.equal(parsePlan({version: 1, scenes: [timed]}, "/tmp").scenes[0].say[0].startMs, 1250);
assert.throws(() => parsePlan({version: 1, scenes: [{...timed, say: [{text: "Now.", startMs: -5}]}]}, "/tmp"), /startMs/);
assert.throws(() => parsePlan({version: 1, scenes: [{...scene, shots: [{file: "x.png", box: [1, 2, 3, 4]}]}]}, "/tmp"), /fractions/);
assert.throws(() => parsePlan({version: 1, scenes: [{...scene, say: []}]}, "/tmp"), /short spoken/);
assert.throws(() => parsePlan({version: 1, scenes: [{...scene, extra: true}]}, "/tmp"), /unknown field/);
console.log("Video plan contract passed.");`,
    ],
    { cwd: directory, encoding: "utf8" },
  );
  assert.equal(videoCheck.trim(), "Video plan contract passed.");
  assembleZoom(directory);
  const embedded = join(directory, "agent-handoff-line.mjs");
  assembleHandoffLine(directory, embedded);
  const browser = { id: "browser", app: "Firefox", title: "Quick picks" };
  const rendered = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { handoffLine, windowAgrees, nearbyWindow, windowSuffix, keepFrameHead,
  agreedPage, pageScope, samePage, joinPageClicks, pageHeading, pageLine, pinWindowLine } from "./agent-handoff-line.mjs";
import { readFileSync } from "node:fs";
const { lines, windows, headings, frames } = JSON.parse(readFileSync(0, "utf8"));
const url = "https://example.com/";
console.log(JSON.stringify({
  lines: lines.map(args => handoffLine(...args)),
  windows: windows.map(observations => windowSuffix(JSON.stringify(observations))),
  agreements: windows.map(observations => windowAgrees(JSON.stringify(observations))),
  headings: headings.map(pair => nearbyWindow(JSON.stringify(pair))),
  frames: frames.map(args => keepFrameHead(...args)),
  pinWindow: pinWindowLine("0:05", "2", JSON.stringify([
    {role: "button", name: "<Save>", states: ["disabled"]},
    {role: "check box", name: "Auto-save", states: ["checked"]},
    {role: "label", name: "Status"},
    {role: "button", name: "Cancel"},
    {role: "button", name: "Outside excerpt"},
  ]), true),
  pages: [
    agreedPage(JSON.stringify([url, url])),
    agreedPage(JSON.stringify([url, ""])),
    agreedPage(JSON.stringify([url, url + "next"])),
    pageScope(false, " near dog"),
    samePage(url, " near dog", url, " near cat"),
    joinPageClicks("clicked", "clicked"),
    joinPageClicks("Circled “Next”", "Circled “Next”"),
    pageLine("0:02", "clicked", ""),
    pageLine("0:03", "clicked", pageHeading(url, pageScope(true, " near dog"))),
  ],
}));`,
    ],
    {
      cwd: directory,
      encoding: "utf8",
      input: JSON.stringify({
        lines: [
          ["Circle", "0:20", "", "", ""],
          ["Circle", "0:20", "②", "“Save”", " (2 strokes)"],
          ["Speech", "0:20", "", "Try this.", ""],
          ["Action", "0:20", "", "clicked", ""],
          ["Circle", "0:20", "", "“Date”, “Tomorrow”, “Date”", "", true],
          ["Circle", "0:20", "", "image “dog”, “dog”", "", true],
          ["Circle", "0:20", "", "button “Next”", "", true],
          ["Circle", "0:20", "②", "", " (3 strokes)", true],
          ["Circle", "0:20", "", "", "", true],
          ["Speech", "0:20", "", "Try this.", "", true],
          ["Action", "0:20", "", "clicked", "", true],
        ],
        windows: [
          [],
          [browser],
          [browser, browser],
          [browser, null],
          [browser, { ...browser, title: "Listen again" }],
          [browser, { ...browser, id: "other" }],
          [{ id: "settings", app: "Apparent" }],
        ],
        headings: [
          [null, { ...browser, title: "Quick picks — Mozilla Firefox" }],
          [browser, browser],
          [browser, { ...browser, title: "Next tab — Mozilla Firefox" }],
          [browser, { ...browser, id: "other" }],
          [
            null,
            { ...browser, app: "Editor", title: "Text — Mozilla Firefox" },
          ],
          [null, { ...browser, app: "chromium", title: "Search - Chromium" }],
          [
            null,
            { ...browser, title: "Robert Davitt | LinkedIn — Mozilla Firefox" },
          ],
          [
            null,
            {
              ...browser,
              app: "com.t3tools.T3Code",
              title: "Apparent / Thread",
            },
          ],
        ],
        frames: [
          [true, true, true],
          [true, false, true],
          [false, true, true],
          [true, false, false],
        ],
      }),
    },
  );
  const { lines, windows, agreements, headings, frames, pages, pinWindow } =
    JSON.parse(rendered);
  assert.ok(pinWindow.startsWith("0:05 Pin 2 nearby window UI (app data):"));
  assert.ok(pinWindow.includes(String.raw`\u003cSave\u003e`));
  assert.ok(pinWindow.includes('"states":["disabled"]'));
  assert.ok(pinWindow.includes('"Cancel"'));
  assert.ok(!pinWindow.includes("Outside excerpt"));
  assert.ok(pinWindow.endsWith(" (partial)"));
  assert.deepEqual(lines, [
    "0:20 Circled: target unidentified",
    "0:20 Circled: ② “Save” (2 strokes)",
    "0:20 Said: “Try this.”",
    "0:20 Action: clicked",
    "0:20 Circled “Date” ×2, “Tomorrow”",
    "0:20 Circled image “dog”, “dog”",
    "0:20 Circled button “Next”",
    "0:20 Circled ②",
    "0:20 Circled",
    "0:20 “Try this.”",
    "0:20 clicked",
  ]);
  assert.deepEqual(windows, [
    " · Window: unknown",
    " · Nearby window: Firefox — Quick picks",
    " · Nearby window: Firefox — Quick picks",
    " · Window: unknown",
    " · Window: unknown",
    " · Window: unknown",
    " · Nearby window: Apparent",
  ]);
  assert.deepEqual(agreements, ["", "yes", "yes", "", "", "", "yes"]);
  assert.deepEqual(headings, [
    " near Quick picks",
    "",
    " near Next tab",
    " near Quick picks",
    " near Text — Mozilla Firefox",
    " near Search",
    " near LinkedIn",
    " near Apparent / Thread",
  ]);
  assert.deepEqual(frames, ["", "yes", "yes", ""]);
  assert.deepEqual(pages, [
    "https://example.com/",
    "",
    "",
    "",
    "",
    "yes",
    "",
    "0:02 clicked",
    "0:03 clicked https://example.com/ near dog",
  ]);
  function run(overrides: object) {
    const request = {
      moment: "10000",
      phrase: null,
      mark: null,
      span: "2000",
      duration: "25000",
      count: "3",
      words: [],
      segments: [],
      keyframes: [],
      ...overrides,
    };
    return JSON.parse(
      execFileSync(process.execPath, [join(directory, "zoom-worker.mjs")], {
        input: JSON.stringify(request),
        encoding: "utf8",
      }),
    );
  }
  assert.deepEqual(run({ keyframes: ["8000", "11000", "11000"] }), {
    status: "plan",
    from: "9500",
    to: "11500",
    times: ["9500", "10500", "11500"],
    nearest: [1, 2, 2],
  });
  assert.deepEqual(run({ moment: "24800" }).times, ["23000", "24000", "25000"]);
  assert.deepEqual(run({ moment: "200", count: "0" }).times, ["0"]);
  assert.deepEqual(run({ moment: "0", duration: "0" }).times, ["0"]);
  assert.deepEqual(
    run({ moment: "1", duration: "2", count: "18446744073709551615" }).times
      .length,
    48,
  );
  assert.deepEqual(
    run({ moment: "9007199254740993", duration: "9007199254740994" }).times,
    ["9007199254738994", "9007199254739994", "9007199254740994"],
  );
  assert.deepEqual(run({ mark: ["9322", "10908"] }).times, [
    "8822",
    "10115",
    "11408",
  ]);
  assert.deepEqual(run({ mark: ["6661", "7182"] }).times, [
    "5921",
    "6921",
    "7921",
  ]);
  assert.equal(run({ mark: ["200", "400"] }).from, "0");
  assert.equal(
    run({ mark: ["13000", "13300"], duration: "13400" }).from,
    "11400",
  );
  assert.deepEqual(run({ moment: "25001" }), { status: "past", at: "25001" });
  const decomposed = { words: [["e\u0301", "9000"]] };
  assert.equal(run({ ...decomposed, phrase: "E" }).from, "8500");
  assert.deepEqual(run({ ...decomposed, phrase: "É" }), { status: "missing" });
  const words = [
    ["𐐀,", "9000"],
    ["Été", "9500"],
    ["𐐨", "10000"],
    ["été!", "10500"],
  ];
  const segments = [["A𐐀\tÉtéZ", "2000"]];
  const phrase = "𐐨\u0085ÉTÉ";
  assert.equal(run({ words, segments, phrase }).from, "8500");
  assert.equal(run({ segments, phrase }).from, "1500");
  for (const query of ["...", "", "missing", "été été"])
    assert.deepEqual(run({ phrase: query, words, segments }), {
      status: "missing",
    });
});
