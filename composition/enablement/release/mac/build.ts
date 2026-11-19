import { createDmg } from "./dmg/build.ts";
import { appDisplayNames, appPlist } from "./metadata.ts";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tooling = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const root = process.env.APPARENT_SOURCE_ROOT ?? tooling;
const env = process.env;
const version = env.APPARENT_PREVIEW_VERSION ?? "";
const build = env.APPARENT_PREVIEW_BUILD_NUMBER ?? "";
const key = env.APPARENT_PREVIEW_PUBLIC_KEY ?? "";
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^\d+\.\d+$/.test(build))
  throw Error("Invalid preview version or build number");
if (
  !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
  Buffer.from(key, "base64").length !== 32
)
  throw Error("Invalid preview public key");
const notarize = env.APPARENT_PREVIEW_NOTARIZE ?? "false";
if (!["true", "false"].includes(notarize))
  throw Error("APPARENT_PREVIEW_NOTARIZE must be true or false");
function run(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
) {
  return execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}
function output(command: string, args: string[]) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}
const sign = ["--force", "--sign", "-"];
const signing = env.APPARENT_APPLE_SIGNING_DIR ?? "";
const identity = env.APPARENT_APPLE_SIGNING_IDENTITY ?? "";
const team = env.APPARENT_APPLE_TEAM_ID ?? "";
if (notarize === "true") {
  for (const name of [
    "APPARENT_APPLE_SIGNING_IDENTITY",
    "APPARENT_APPLE_TEAM_ID",
    "APPARENT_APPLE_SIGNING_DIR",
    "APPARENT_NOTARY_KEY_ID",
    "APPARENT_NOTARY_ISSUER",
  ])
    if (!env[name]) throw Error(`Missing signing input ${name}`);
  if (
    !identity.startsWith("Developer ID Application: ") ||
    !identity.endsWith(` (${team})`)
  )
    throw Error("Expected Developer ID for configured team");
  readFileSync(join(signing, "signing.keychain-db"));
  if (!readFileSync(join(signing, "notary.p8")).length)
    throw Error("Missing notarization key");
  sign.splice(
    0,
    sign.length,
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--keychain",
    join(signing, "signing.keychain-db"),
    "--sign",
    identity,
  );
}
const sparkle = output("bash", [
  "capture/desktop/scripts/release/setup-sparkle.sh",
]);
run("cargo", ["build", "--release", "--locked", "-j", "3"], {
  env: {
    ...env,
    APPARENT_PREVIEW_BUILD: "1",
    APPARENT_HELPER_BUNDLE_ID: "dev.simonvanlaak.apparent.preview.helper",
    APPARENT_RELEASE_VERSION: version,
    APPARENT_RELEASE_CHANNEL: env.APPARENT_RELEASE_CHANNEL ?? "preview",
    APPARENT_REPORTING_ENVIRONMENT: "production",
  },
});
const dist = join(root, "dist");
const app = join(dist, "Apparent Preview.app");
rmSync(app, { recursive: true, force: true });
for (const directory of ["MacOS", "Resources", "Frameworks"])
  mkdirSync(join(app, "Contents", directory), { recursive: true });
for (const name of ["apparent", "apparent-helper"])
  cpSync(join(root, "target/release", name), join(app, "Contents/MacOS", name));
for (const [source, name] of [
  ["capture/desktop/assets/Apparent.icns", "Apparent.icns"],
  ["shared/assets/fonts/HostGrotesk-Variable.ttf", "HostGrotesk-Variable.ttf"],
  ...["apparent-wordmark.png", "apparent-a.png", "connect-frogs.png"].map(
    (name) => ["shared/assets/brand/" + name, name],
  ),
])
  cpSync(join(root, source), join(app, "Contents/Resources", name));
const prepared = env.APPARENT_PREPARED_FRONTEND;
if (prepared)
  run(process.execPath, [
    "--experimental-strip-types",
    join(tooling, "composition/enablement/release/mac/metadata.ts"),
    "notes",
    prepared,
    join(app, "Contents/Resources/note-ui"),
  ]);
else
  run("node", [
    "capture/desktop/ui/frontend/scripts/package-notes.mjs",
    join(app, "Contents/Resources/note-ui"),
  ]);
run("ditto", [
  join(sparkle, "Sparkle.framework"),
  join(app, "Contents/Frameworks/Sparkle.framework"),
]);
writeFileSync(join(app, "Contents/Info.plist"), appPlist(version, build, key));
const localized = join(app, "Contents/Resources/en.lproj");
mkdirSync(localized);
writeFileSync(join(localized, "InfoPlist.strings"), appDisplayNames);
const settings = join(app, "Contents/Resources/settings");
if (prepared)
  run(process.execPath, [
    "--experimental-strip-types",
    join(tooling, "composition/enablement/release/mac/frontend.ts"),
    "stage",
    prepared,
    settings,
  ]);
else
  run("python3", [
    "capture/desktop/scripts/packaging/stage-settings.py",
    settings,
    "--sign",
    notarize === "true" ? identity : "-",
    ...(notarize === "true"
      ? ["--keychain", join(signing, "signing.keychain-db")]
      : []),
  ]);
run("plutil", ["-lint", join(app, "Contents/Info.plist")]);
const framework = join(app, "Contents/Frameworks/Sparkle.framework");
for (const [name, args] of [
  ["XPCServices/Installer.xpc", []],
  ["XPCServices/Downloader.xpc", ["--preserve-metadata=entitlements"]],
  ["Autoupdate", []],
  ["Updater.app", []],
] as const)
  run("codesign", [...sign, ...args, join(framework, "Versions/B", name)]);
run("codesign", [...sign, framework]);
const entitlements =
  notarize === "true"
    ? [
        "--entitlements",
        join(root, "capture/desktop/scripts/packaging/Apparent.entitlements"),
      ]
    : [];
run("codesign", [
  ...sign,
  ...entitlements,
  "--identifier",
  "dev.simonvanlaak.apparent.preview.helper",
  join(app, "Contents/MacOS/apparent-helper"),
]);
run("codesign", [
  ...sign,
  ...entitlements,
  "--identifier",
  "dev.simonvanlaak.apparent.preview",
  app,
]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
function notarizeBundle(bundle: string, archive: string) {
  if (notarize !== "true") return;
  run("ditto", [
    "-c",
    "-k",
    "--sequesterRsrc",
    "--keepParent",
    bundle,
    archive,
  ]);
  try {
    submit(archive);
  } finally {
    rmSync(archive, { force: true });
  }
  run("xcrun", ["stapler", "staple", bundle]);
  run("xcrun", ["stapler", "validate", bundle]);
  run("spctl", ["--assess", "--type", "execute", "--verbose=2", bundle]);
}
function submit(file: string) {
  run("xcrun", [
    "notarytool",
    "submit",
    file,
    "--key",
    join(signing, "notary.p8"),
    "--key-id",
    env.APPARENT_NOTARY_KEY_ID!,
    "--issuer",
    env.APPARENT_NOTARY_ISSUER!,
    "--wait",
    "--timeout",
    "30m",
  ]);
}
if (notarize === "true") {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", app], {
    cwd: root,
    encoding: "utf8",
  });
  if (
    result.status !== 0 ||
    !result.stderr.split("\n").includes("TeamIdentifier=" + team) ||
    !result.stderr.split("\n").includes("Authority=" + identity)
  )
    throw Error("Actual signing authority/team differs");
}
notarizeBundle(app, join(dist, "preview-notary.zip"));
const name = `Apparent-Preview-${version}-arm64.dmg`;
const dmg = join(dist, name);
rmSync(dmg, { force: true });
createDmg(app, dmg, version, build);
run("hdiutil", ["verify", dmg]);
if (notarize === "true") {
  run("codesign", [...sign, dmg]);
  submit(dmg);
  run("xcrun", ["stapler", "staple", dmg]);
  run("xcrun", ["stapler", "validate", dmg]);
  run("spctl", [
    "--assess",
    "--type",
    "open",
    "--context",
    "context:primary-signature",
    "--verbose=2",
    dmg,
  ]);
}
writeFileSync(
  dmg + ".sha256",
  execFileSync("shasum", ["-a", "256", name], { cwd: dist, encoding: "utf8" }),
);
run("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  app,
  join(dist, `Apparent-Preview-${version}-arm64.zip`),
]);
