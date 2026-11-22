import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { compile } from "./compile.ts";

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { stdio: "inherit" });
const read = (command: string, args: string[]) =>
  execFileSync(command, args, { encoding: "utf8" }).trim();

const base =
  "public.ecr.aws/amazonlinux/amazonlinux@sha256:3f018977be7a3473a0a473ed105b244b8bdec8683ecb24962f675db23017137b";
const toolchain = "1.99.1";
const recipe = String.raw`FROM ${base}

RUN dnf -y --setopt=install_weak_deps=False install \
    gcc gcc-c++ clang cmake ninja-build make pkgconf-pkg-config git tar gzip xz unzip zip \
    fontconfig-devel freetype-devel alsa-lib-devel libxcb-devel libX11-devel \
    libxkbcommon-devel libxkbcommon-x11-devel vulkan-loader-devel openssl-devel \
    dbus-devel gstreamer1-devel gstreamer1-plugins-base-devel nodejs22 patchelf \
    && dnf clean all \
    && ln -s "$(command -v node-22 || command -v node)" /usr/local/bin/node

ENV CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup
ENV PATH=/opt/cargo/bin:$PATH
RUN curl -fsS https://sh.rustup.rs -o /tmp/rustup-init.sh \
    && sh /tmp/rustup-init.sh -y --profile minimal --default-toolchain ${toolchain} --no-modify-path \
    && chmod -R a+rX /opt/rustup /opt/cargo \
    && rm /tmp/rustup-init.sh
`;

const [directory, appImage, prebuilt] = process.argv.slice(2);
if (
  !directory ||
  !appImage ||
  process.platform !== "linux" ||
  process.arch !== "x64"
) {
  throw Error(
    "Usage on Linux x86-64: build.ts OUTPUT_DIRECTORY (--compile-only | PRODUCER_APPIMAGE [PREBUILT_DIRECTORY])",
  );
}
const output = resolve(directory);
const revision = read("git", ["rev-parse", "HEAD"]);
if (process.env.CANDIDATE_SHA && revision !== process.env.CANDIDATE_SHA)
  throw Error("Unexpected source revision");
const version = /^version = "([\d.]+)"$/m.exec(
  readFileSync("Cargo.toml", "utf8"),
)?.[1];
if (!version) throw Error("Missing Cargo version");
const archive = `Apparent-CLI-${version}-amazon-linux-2023-x86_64.zip`;
const job = mkdtempSync(join(tmpdir(), "apparent-dev-amazon-linux-cli-"));
const extracted = join(job, "extracted");
const archivePath = join(job, archive);
const fixture = join(job, "smoke.apparent");

try {
  const securityOptions: string[] = JSON.parse(
    read("docker", ["info", "--format", "{{json .SecurityOptions}}"]),
  );
  const buildUser = securityOptions.includes("name=rootless")
    ? "0:0"
    : `${process.getuid!()}:${process.getgid!()}`;
  if (appImage === "--compile-only") {
    mkdirSync(output, { recursive: true });
    compile(join(output, archive), revision, buildUser, recipe, toolchain);
  } else {
    execFileSync(resolve(appImage), ["demo", "--out", fixture], {
      env: {
        ...process.env,
        APPIMAGE_EXTRACT_AND_RUN: "1",
        APPARENT_CONFIG: join(job, "config.json"),
        HOME: job,
        TMPDIR: job,
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    if (prebuilt) copyFileSync(join(resolve(prebuilt), archive), archivePath);
    else compile(archivePath, revision, buildUser, recipe, toolchain);

    run("unzip", ["-q", archivePath, "-d", extracted]);
    run("docker", [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev",
      "--user",
      buildUser,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--mount",
      `type=bind,src=${extracted}/apparent-cli,dst=/cli,readonly`,
      "--mount",
      `type=bind,src=${fixture},dst=/fixture.apparent,readonly`,
      "-e",
      "HOME=/tmp",
      base,
      "bash",
      "-euo",
      "pipefail",
      "-c",
      [
        'test "$(getconf GNU_LIBC_VERSION)" = "glibc 2.34"',
        '/cli/apparent --version | grep -F -- "$1"',
        "/cli/apparent inspect /fixture.apparent > /tmp/summary.txt",
        'grep -F "row spacing" /tmp/summary.txt',
        "/cli/apparent inspect /fixture.apparent --marks > /tmp/marks.txt",
        'grep -F "Send button" /tmp/marks.txt',
        "test -s /fixture.apparent/contact-sheet.png",
        "/cli/apparent fetch --help > /dev/null",
      ].join("\n"),
      "verify-cli",
      `${version} · ${revision.slice(0, 7)}`,
    ]);

    mkdirSync(output, { recursive: true });
    const hash = createHash("sha256")
      .update(readFileSync(archivePath))
      .digest("hex");
    copyFileSync(archivePath, join(output, archive));
    writeFileSync(join(output, `${archive}.sha256`), `${hash}  ${archive}\n`);
  }
} finally {
  if (process.env.KEEP_CLI_BUILD === "1")
    console.log(`Amazon Linux CLI build files: ${job}`);
  else rmSync(job, { recursive: true, force: true });
}
