import { assertCaskUpdate, homebrewCask } from "./publication/homebrew.ts";
import { macProduct, macFeedBranch } from "./metadata.ts";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.platform !== "darwin" || process.arch !== "arm64")
  throw Error("An ARM Mac is required");
if (process.env.APPARENT_SOURCE_ROOT)
  process.chdir(process.env.APPARENT_SOURCE_ROOT);
const version = process.env.APPARENT_PREVIEW_VERSION!;
const team = process.env.APPARENT_APPLE_TEAM_ID!;
const product = macProduct(process.env.RELEASE_CHANNEL);
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Z0-9]{10}$/.test(team))
  throw Error("Invalid installation verification inputs");
process.env.HOMEBREW_NO_AUTO_UPDATE = "1";
process.env.HOMEBREW_NO_ANALYTICS = "1";
function run(command: string, args: string[]) {
  execFileSync(command, args, { stdio: "inherit" });
}
function output(command: string, args: string[]) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}
const dmg = join(process.cwd(), `dist/${product.asset}-${version}-arm64.dmg`);
if (product.nightly) {
  const app = join("/Applications", product.name + ".app");
  if (existsSync(app))
    throw Error("Nightly is already installed on this runner");
  const mount = mkdtempSync(join(tmpdir(), "apparent-dev-nightly-install-"));
  let installed = false;
  try {
    run("hdiutil", ["attach", dmg, "-nobrowse", "-mountpoint", mount]);
    try {
      const installer = join(
        mount,
        "Install apparent.app/Contents/MacOS/Installer",
      );
      run(installer, ["--request", '{"action":"install","replace":false}']);
      installed = true;
      run("codesign", ["--verify", "--deep", "--strict", app]);
      run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
      run("xcrun", ["stapler", "validate", app]);
      for (const [field, expected] of [
        ["CFBundleIdentifier", product.id],
        ["CFBundleShortVersionString", version],
        [
          "SUFeedURL",
          `https://raw.githubusercontent.com/tryapparent/apparent/${macFeedBranch}/${product.feed}`,
        ],
      ]) {
        if (
          output("/usr/libexec/PlistBuddy", [
            "-c",
            `Print ${field}`,
            join(app, "Contents/Info.plist"),
          ]) !== expected
        )
          throw Error(`Installed Nightly ${field} differs`);
      }
      const label = output(join(app, "Contents/MacOS/apparent"), ["--version"]);
      if (
        !label.includes(
          `${version} · ${process.env.CANDIDATE_SHA!.slice(0, 7)}`,
        )
      )
        throw Error("Installed Nightly version/source differs");
    } finally {
      run("hdiutil", ["detach", mount]);
    }
  } finally {
    if (installed) rmSync(app, { recursive: true, force: true });
    if (existsSync(mount)) rmdirSync(mount);
  }
  process.exit(0);
}
const checksum = createHash("sha256").update(readFileSync(dmg)).digest("hex");
run("brew", ["tap", "tryapparent/tap"]);
const tap = output("brew", ["--repository", "tryapparent/tap"]);
const caskPath = join(tap, "Casks/apparent.rb");
const previous = existsSync(caskPath) ? readFileSync(caskPath, "utf8") : null;
const candidate = homebrewCask(version, checksum, "v" + version);
const upgrade = process.env.RELEASE_CHANNEL === "stable" && previous !== null;
if (upgrade) assertCaskUpdate(previous, candidate);
const token = "tryapparent/tap/apparent";
try {
  if (upgrade) run("brew", ["install", "--cask", token]);
  writeFileSync(caskPath, candidate);
  run("brew", ["style", "--cask", token]);
  const local = candidate.replace(
    /  url "[^"\n]+",\n      verified: "[^"\n]+"/,
    '  url "file://' + dmg + '"',
  );
  if (local === candidate) throw Error("Could not select the exact local DMG");
  writeFileSync(caskPath, local);
  if (upgrade) run("brew", ["upgrade", "--cask", "--greedy", token]);
  else run("brew", ["install", "--cask", token]);
  const app = "/Applications/Apparent Preview.app";
  run("codesign", ["--verify", "--deep", "--strict", app]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
  run("xcrun", ["stapler", "validate", app]);
  const { spawnSync } = await import("node:child_process");
  const signature = spawnSync("codesign", ["-dv", "--verbose=4", app], {
    encoding: "utf8",
  });
  if (
    signature.status !== 0 ||
    !signature.stderr.split("\n").includes(`TeamIdentifier=${team}`)
  )
    throw Error("Installed team differs");
  for (const [field, expected] of [
    ["CFBundleIdentifier", "dev.simonvanlaak.apparent.preview"],
    ["CFBundleShortVersionString", version],
  ])
    if (
      output("/usr/libexec/PlistBuddy", [
        "-c",
        `Print ${field}`,
        join(app, "Contents/Info.plist"),
      ]) !== expected
    )
      throw Error("Installed identity/version differs");
  run(join(app, "Contents/MacOS/apparent"), ["--version"]);
  run(
    join(
      app,
      "Contents/Resources/settings/runtime/Electron.app/Contents/MacOS/Electron",
    ),
    ["--version"],
  );
  run("brew", ["reinstall", "--cask", token]);
  run("brew", ["uninstall", "--cask", token]);
  if (existsSync(app)) throw Error("Homebrew uninstall left the app installed");
} finally {
  if (existsSync("/Applications/Apparent Preview.app"))
    run("brew", ["uninstall", "--cask", token]);
  if (previous !== null) writeFileSync(caskPath, previous);
  run("brew", ["untap", "tryapparent/tap"]);
}
