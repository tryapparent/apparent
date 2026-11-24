import { execFileSync } from "node:child_process";

export const steps = [
  "Welcome",
  "HowItWorks",
  "Permissions",
  "Shortcut",
  "TryIt",
  "Done",
];

export const inputs = {
  visible: ["permissions_ready"],
  enter: ["permissions_ready"],
  advance: ["repair", "permissions_ready"],
  back: ["repair", "permissions_ready"],
  primary: ["permissions_ready", "practice", "chosen", "tested", "editing"],
  practice_control: ["recording", "target_stage"],
  resume_capture: ["practice", "completed"],
};

export type Table = Record<keyof typeof inputs, string[]>;

export function traversalTable(directory: string): string {
  return execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
import assert from "node:assert/strict";
import traversal from "./tour-traversal.mjs";

const steps = ${JSON.stringify(steps)};
const cases = Object.entries(${JSON.stringify(inputs)});
const table = Object.fromEntries(cases.map(([name, flags]) => {
  const variants = name === "primary" ? ["Stay", "Advance", "Close"] : steps;
  const rows = steps.map(step => Array.from({ length: 2 ** flags.length }, (_, index) => {
    const args = flags.map((_, bit) => Boolean(index & (1 << bit)));
    const result = traversal[name]({ $: "Tour" + step }, ...args);
    if (name === "visible" || name === "practice_control") {
      assert.equal(typeof result, "boolean");
      return Number(result);
    }
    if (name === "advance" && result.$ === "TourDismiss") return steps.length;
    const variant = variants.indexOf((name === "advance" ? result.step.$ : result.$).slice(4));
    assert.notEqual(variant, -1);
    return variant;
  }).join(""));
  return [name, rows];
}));
console.log(JSON.stringify(table, null, 2));
`,
    ],
    { cwd: directory, encoding: "utf8" },
  );
}
