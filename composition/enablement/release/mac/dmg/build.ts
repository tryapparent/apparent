import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function finderLayout(app: string, installer: string, version: string, build: string) {
  return {
    title: `apparent ${version} (${build})`,
    background: fileURLToPath(new URL("background.png", import.meta.url)),
    filesystem: "HFS+",
    format: "UDZO",
    "compression-level": 9,
    "icon-size": 88,
    "text-size": 13,
    window: { position: { x: 80, y: 100 }, size: { width: 576, height: 384 } },
    contents: [
      { path: installer, type: "file", x: 288, y: 121 },
      { path: app, type: "file", x: 162, y: 251 },
      { path: "/Applications", type: "link", x: 414, y: 251 },
    ],
  };
}

const toolByArch = {
  arm64: [
    "arm64",
    "793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb",
  ],
  x64: [
    "x86_64",
    "1664972f9cc2d6e8fce3b63e42cd30078aff602669c5856939c4519921200433",
  ],
} as const;

export function createDmg(app: string, installer: string, dmg: string, version: string, build: string) {
  const arch = process.arch;
  if (process.platform !== "darwin" || (arch !== "arm64" && arch !== "x64"))
    throw Error("DMG creation requires an Apple silicon or Intel Mac");

  const [architecture, sha256] = toolByArch[arch];
  const name = `dmgbuild-bundle-${architecture}-75c8a6c.tar.gz`;
  const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/dmg-builder%401.2.5/${name}`;
  const workspace = mkdtempSync(join(dirname(dmg), ".dmg-build-"));
  try {
    const archive = join(workspace, name);
    execFileSync("curl", [
      "--fail", "--silent", "--show-error", "--location", "--retry", "2",
      "--connect-timeout", "15", "--max-time", "120", "--output", archive, url,
    ]);
    if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== sha256)
      throw Error("Unexpected dmgbuild archive checksum");
    execFileSync("tar", ["-xzf", archive, "-C", workspace]);

    const settings = join(workspace, "layout.json");
    const layout = finderLayout(app, installer, version, build);
    writeFileSync(settings, JSON.stringify(layout));
    execFileSync(join(workspace, "dmgbuild"), ["-s", settings, layout.title, dmg], {
      stdio: "inherit",
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
