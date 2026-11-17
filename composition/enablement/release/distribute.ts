import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paired } from "./manifest.ts";
import { restore } from "./candidate.ts";

const [command, output] = process.argv.slice(2);
if (
  !["feed", "cask-prepare"].includes(command) ||
  (command === "cask-prepare" && !output)
)
  throw Error("Use feed | cask-prepare OUTPUT");
const runId = process.env.PRODUCER_RUN!,
  attempt = Number(process.env.PRODUCER_ATTEMPT);
const directory = mkdtempSync(join(tmpdir(), "apparent-dev-distribution-"));
try {
  const candidate = paired(await restore(runId, attempt, directory));
  if (candidate.channel !== "stable")
    throw Error("Feed and cask distribution requires a stable candidate");
  const payload = join(directory, `stable-macos-aarch64-${attempt}`);
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "composition/enablement/release/mac/publication/cli.ts",
      command,
      payload,
      ...(output ? [output] : []),
    ],
    { stdio: "inherit" },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
