import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function admitLinux(): void {
  const source = process.env.REQUEST_SHA!;
  const channel = process.env.RELEASE_CHANNEL;
  if (process.env.BRIDGE_COMMIT) {
    if (process.env.GITHUB_REF !== "refs/heads/main" || channel)
      throw Error("Invalid compatibility bridge request");
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "capture/desktop/scripts/linux/maintenance/signing-bridge.ts",
        "inspect",
        process.env.BRIDGE_COMMIT,
      ],
      { stdio: "inherit" },
    );
    return;
  }
  if (process.env.VERIFY_ONLY === "true") {
    if (channel || !process.env.GITHUB_REF?.startsWith("refs/heads/"))
      throw Error("Linux packaging verification requires a branch");
    appendFileSync(process.env.GITHUB_OUTPUT!, `sha=${source}\n`);
    return;
  }
  if (!["main", "stable"].includes(channel ?? ""))
    throw Error("Use Release for Linux and Mac publication");
  const { VERIFY_RUN_ID, VERIFY_RUN_ATTEMPT } = process.env;
  if (
    !/^[1-9]\d*$/.test(VERIFY_RUN_ID ?? "") ||
    !/^[1-9]\d*$/.test(VERIFY_RUN_ATTEMPT ?? "")
  )
    throw Error(
      "Linux publication needs the exact verification run and attempt admitted by Release",
    );
  execFileSync(
    "python3",
    [
      "enablement/release_gate.py",
      "--platform",
      "linux",
      "--sha",
      source,
      "--run-id",
      VERIFY_RUN_ID!,
      "--run-attempt",
      VERIFY_RUN_ATTEMPT!,
    ],
    { stdio: "inherit" },
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  admitLinux();
