import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "inherit" });
}
const tooling = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const command = process.argv[2];
if (process.env.APPARENT_SOURCE_ROOT && command !== "preview-admit")
  process.chdir(process.env.APPARENT_SOURCE_ROOT);
if (command === "preview-admit") {
  const env = process.env;
  if (env.GITHUB_REF === "refs/heads/t3/onboarding-mac-release-baseline") {
    if (
      env.RELEASE_SOURCE_SHA !== env.GITHUB_SHA ||
      env.APPARENT_PREVIEW_NOTARIZE !== "true"
    )
      throw Error("Invalid historical baseline");
    run("python3", [
      "enablement/release_gate.py",
      "--platform",
      "macos",
      "--sha",
      env.GITHUB_SHA!,
      "--onboarding-candidate",
    ]);
    appendFileSync(
      env.GITHUB_ENV!,
      "APPARENT_PREVIEW_VERSION=0.12.2\nAPPARENT_RELEASE_VERSION=0.12.2\nAPPARENT_PREVIEW_BUILD_NUMBER=12.2\nAPPARENT_PREVIEW_TAG=preview-mac-12-2\n",
    );
  } else {
    run("python3", [
      "enablement/release_gate.py",
      "--platform",
      "macos",
      "--sha",
      env.RELEASE_SOURCE_SHA!,
    ]);
    appendFileSync(
      env.GITHUB_ENV!,
      "APPARENT_PREVIEW_BUILD_NUMBER=" +
        env.GITHUB_RUN_ID +
        "." +
        env.GITHUB_RUN_ATTEMPT +
        "\n",
    );
  }
} else if (command === "arm") {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw Error("An ARM Mac is required");
  appendFileSync(
    process.env.GITHUB_ENV!,
    `APPARENT_APPLE_SIGNING_DIR=${process.env.RUNNER_TEMP}/apparent-apple-signing\nAPPARENT_PREPARED_FRONTEND=${process.env.RUNNER_TEMP}/mac-frontend\n`,
  );
} else if (command === "assemble") {
  run(process.execPath, [
    "--experimental-strip-types",
    join(tooling, "composition/enablement/release/mac/build.ts"),
  ]);
  run("bash", [
    "capture/desktop/scripts/support/check-ca-roots.sh",
    "target/release/apparent",
  ]);
  run("target/release/apparent", ["--help"]);
} else if (command === "seal") {
  run("swift", [
    "capture/desktop/scripts/release/verify-preview-sparkle-key.swift",
  ]);
  const directory = join(process.env.RUNNER_TEMP!, "mac-candidate");
  mkdirSync(directory);
  const version = process.env.APPARENT_VERSION!;
  const zip = `dist/Apparent-Preview-${version}-arm64.zip`;
  const sparkle = execFileSync(
    "bash",
    ["capture/desktop/scripts/release/setup-sparkle.sh"],
    { encoding: "utf8" },
  ).trim();
  const signature = execFileSync(
    join(sparkle, "bin/sign_update"),
    ["--ed-key-file", "-", zip],
    {
      input: process.env.SPARKLE_PREVIEW_PRIVATE_KEY + "\n",
      encoding: "utf8",
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  writeFileSync(join(directory, "sparkle-signature-attributes.txt"), signature);
  for (const file of [
    `Apparent-Preview-${version}-arm64.dmg`,
    `Apparent-Preview-${version}-arm64.dmg.sha256`,
    `Apparent-Preview-${version}-arm64.zip`,
  ])
    cpSync(join("dist", file), join(directory, file));
  run(process.execPath, [
    "--experimental-strip-types",
    join(tooling, "composition/enablement/release/mac/distribution.ts"),
    directory,
  ]);
  run(process.execPath, [
    "--experimental-strip-types",
    join(tooling, "composition/enablement/release/manifest.ts"),
    "create",
    directory,
    "macos",
    "aarch64",
  ]);
} else throw Error("Use arm, assemble or seal");
