import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const run = (command: string, args: string[]) =>
  execFileSync(command, args, { stdio: "inherit" });
export function compile(
  archivePath: string,
  revision: string,
  buildUser: string,
  recipe: string,
  toolchain: string,
) {
  const job = mkdtempSync(join(tmpdir(), "apparent-dev-amazon-linux-compile-"));
  const source = join(job, "source");
  const builder = `apparent-amazon-linux-cli:${revision.slice(0, 12)}`;
  try {
    mkdirSync(source);
    const sourceArchive = join(job, "source.tar");
    run("git", ["archive", "--format=tar", "-o", sourceArchive, revision]);
    run("tar", ["-xf", sourceArchive, "-C", source]);
    rmSync(sourceArchive);

    execFileSync("docker", ["build", "-t", builder, "-"], {
      input: recipe,
      stdio: ["pipe", "inherit", "inherit"],
    });
    run("docker", [
      "run",
      "--rm",
      "--user",
      buildUser,
      "--mount",
      `type=bind,src=${source},dst=/src,readonly`,
      "--mount",
      `type=bind,src=${job},dst=/job`,
      "--workdir",
      "/src",
      "-e",
      "HOME=/job",
      "-e",
      "CARGO_HOME=/job/cargo",
      "-e",
      "CARGO_TARGET_DIR=/job/target",
      "-e",
      `RUSTUP_TOOLCHAIN=${toolchain}`,
      "-e",
      `GITHUB_SHA=${revision}`,
      builder,
      "bash",
      "-ec",
      'cargo build --release --locked && node --experimental-strip-types /src/composition/enablement/release/amazon-linux-cli/package.ts /job/target/release/apparent "$1"',
      "build-cli",
      "/job/candidate.zip",
    ]);

    copyFileSync(join(job, "candidate.zip"), archivePath);
  } finally {
    if (process.env.KEEP_CLI_BUILD === "1") console.log(job);
    else rmSync(job, { recursive: true, force: true });
  }
}
