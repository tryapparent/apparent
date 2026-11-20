import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidateIdentity } from "./manifest.ts";
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
  const channel = process.env.MAC_FEED_CHANNEL ?? "stable";
  if (channel !== "stable" && (channel !== "main" || command !== "feed"))
    throw Error("Unsupported distribution channel");
  const pairedMain = channel === "main";
  candidateIdentity(
    await restore(runId, attempt, directory, channel, pairedMain),
    channel,
    pairedMain,
  );
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
