import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { optional } from "./github.ts";

function node(file: string, args: string[]): void {
  execFileSync("node", ["--experimental-strip-types", file, ...args], {
    stdio: "inherit",
  });
}
export function admitLinux(): void {
  let source = process.env.REQUEST_SHA!;
  const tag = process.env.TAG,
    verify = process.env.VERIFY_ONLY === "true";
  if (tag)
    throw Error(
      "Independent Linux stable publication is retired; use Release application",
    );
  if (process.env.BRIDGE_COMMIT) {
    if (
      process.env.GITHUB_REF !== "refs/heads/main" ||
      verify ||
      process.env.PUBLISH_MAIN === "true"
    )
      throw Error("Invalid compatibility bridge request");
    source = execFileSync(
      "node",
      [
        "--experimental-strip-types",
        "capture/desktop/scripts/linux/maintenance/signing-bridge.ts",
        "inspect",
        process.env.BRIDGE_COMMIT,
      ],
      { encoding: "utf8" },
    ).trim();
  }
  if (verify) {
    appendFileSync(process.env.GITHUB_OUTPUT!, `sha=${source}\n`);
    return;
  }
  if (
    process.env.STABLE_CANDIDATE !== "true" &&
    ["workflow_run", "push"].includes(process.env.GITHUB_EVENT_NAME!)
  ) {
    try {
      node("enablement/ci/routing/streams.ts", ["capture", source]);
    } catch {
      return;
    }
  }
  execFileSync(
    "python3",
    [
      "enablement/release_gate.py",
      "--platform",
      "linux",
      "--sha",
      source,
      ...(process.env.STABLE_CANDIDATE !== "true" && process.env.VERIFY_RUN_ID
        ? ["--run-id", process.env.VERIFY_RUN_ID]
        : []),
    ],
    { stdio: "inherit" },
  );
}
export function needed(): void {
  const build =
    process.env.STABLE_CANDIDATE === "true" ||
    process.env.VERIFY_ONLY === "true" ||
    !(
      process.env.PUBLISH_MAIN === "true" &&
      !process.env.TAG &&
      optional<{ draft: boolean }>(
        `releases/tags/linux-main-v2-${process.env.CANDIDATE_SHA}`,
      )?.draft === false
    );
  appendFileSync(process.env.GITHUB_OUTPUT!, `build=${build}\n`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === "admit") admitLinux();
  else if (process.argv[2] === "needed") needed();
  else throw Error("Usage: linux.ts admit|needed");
}
