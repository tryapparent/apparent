import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [arch] = process.argv.slice(2);
if (arch !== "x86_64" && arch !== "aarch64")
  throw Error("Expected x86_64 or aarch64");

const { APPARENT_RELEASE_VERSION: version, GITHUB_OUTPUT, TAG } = process.env;
if (!version || !GITHUB_OUTPUT)
  throw Error("Expected the resolved desktop version and GITHUB_OUTPUT");
if (TAG && TAG !== `v${version}`)
  throw Error(`Tag ${TAG} does not match Cargo.toml ${version}`);

const deferEncoderCheck =
  process.env.GITHUB_ACTIONS === "true" &&
  fileURLToPath(import.meta.url) ===
    resolve(
      ".release-control/composition/enablement/release/linux/appimage.ts",
    );

execFileSync(
  "./capture/desktop/scripts/linux/appimage/appimage.sh",
  ["target/release/apparent"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      APPARENT_APPIMAGE_ENCODER_CHECK_IN_DIST: deferEncoderCheck ? "1" : "0",
    },
  },
);

const name = `Apparent-${version}-linux-${arch}.AppImage`;
const destination = join("dist", name);
await mkdir("dist", { recursive: true });
await copyFile(
  join("target", "appimage", `Apparent-${arch}.AppImage`),
  destination,
);
const hash = createHash("sha256");
for await (const bytes of createReadStream(destination)) hash.update(bytes);
await writeFile(destination + ".sha256", `${hash.digest("hex")}  ${name}\n`);
await appendFile(GITHUB_OUTPUT, `name=${name}\n`);
