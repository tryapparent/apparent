import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { compilerMessages, newWarnings, type Warning } from "./messages.ts";
import { diagnosticsPlan, type Target } from "./targets.ts";

type Environment = NodeJS.ProcessEnv;
const read = (
  program: string,
  args: string[],
  cwd: string,
  env = process.env,
) =>
  execFileSync(program, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function version(cwd: string, env: Environment): string {
  try {
    return (
      read("cargo", ["-Vv"], cwd, env) +
      "\n" +
      read(env.RUSTC || "rustc", ["-vV"], cwd, env)
    );
  } catch {
    throw Error(
      "Install the repository's supported Rust toolchain (cargo and rustc) before pushing",
    );
  }
}

async function cargoCheck(
  root: string,
  target: Target,
  env: Environment,
  stage: string,
): Promise<Warning[]> {
  const work = path.join(root, path.dirname(target.manifest));
  const args = [
    "check",
    "--locked",
    "--offline",
    "--message-format=json",
    "--manifest-path",
    path.basename(target.manifest),
    "--package",
    target.package,
    "--jobs",
    env.T3_BUILD_JOBS || "3",
    ...target.args,
  ];
  const start = performance.now();
  const compiler = compilerMessages(root, (message) => console.error(message));
  const child = spawn("cargo", args, {
    cwd: work,
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const completion = new Promise<number | null>((resolve) =>
    child.once("error", () => resolve(null)).once("close", resolve),
  );
  let malformed = false;
  for await (const line of createInterface({ input: child.stdout })) {
    try {
      compiler.read(line);
    } catch {
      malformed = true;
    }
  }
  if ((await completion) !== 0 || !compiler.finished || malformed)
    throw Error(
      `${stage} Rust diagnostic check failed for ${target.manifest}. Check the Cargo output above, install its native prerequisites and provision the locked graph with cargo fetch --locked --manifest-path ${target.manifest} for the failing revision, then retry.`,
    );
  console.error(
    `Rust diagnostics: ${stage} ${target.package}, ${compiler.warnings.length} dead_code warnings (${Math.round(performance.now() - start)} ms)`,
  );
  return compiler.warnings;
}

export async function checkRust(
  cwd: string,
  base: string,
  head: string,
): Promise<void> {
  const git = (...args: string[]) => read("git", args, cwd);
  const pin = (hash: string) => {
    if (!/^[a-f0-9]{40,64}$/.test(hash))
      throw Error("Expected a full commit ID");
    return git("rev-parse", "--verify", hash + "^{commit}");
  };
  try {
    base = pin(base);
    head = pin(head);
    git("merge-base", "--is-ancestor", base, head);
  } catch {
    throw Error(
      "Rust diagnostics require the main integration checkpoint. Fetch origin/main and retry from a checkout with candidate and baseline history.",
    );
  }
  const paths = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    base,
    head,
    "--",
  )
    .split("\0")
    .filter(Boolean);
  const { selected, demo } = diagnosticsPlan(paths);
  if (demo)
    console.error(
      "Rust diagnostics: the site video demo requires its separate Metal/media build and has no tracked Cargo lock; host hook coverage does not include it",
    );
  if (!selected.length) return;
  const { materialize } = await import(
    "../../../shared/enablement/dependency-policy/fast/materialize.ts"
  );
  if (!["linux", "darwin"].includes(process.platform))
    throw Error(
      "Rust diagnostic checks require a supported Linux or macOS host",
    );
  const sharedEnv = { ...process.env };
  for (const name of Object.keys(sharedEnv))
    if (name.startsWith("GIT_")) delete sharedEnv[name];
  const toolchain = version(cwd, sharedEnv);
  const host = toolchain.match(/^host: (.+)$/m)?.[1];
  if (
    !host ||
    (sharedEnv.CARGO_BUILD_TARGET && sharedEnv.CARGO_BUILD_TARGET !== host)
  )
    throw Error(
      "Rust diagnostics require the native Cargo target; remove the cross-target override and retry on the affected OS",
    );
  console.error(
    `Rust diagnostics: ${host}; platform-specific cfg on other hosts is outside this check`,
  );
  const scratch = mkdtempSync("/tmp/apparent-dev-rust-diagnostics-");
  const candidate = path.join(scratch, "candidate");
  const baseline = path.join(scratch, "main");
  let haveBaseline = false;
  try {
    materialize(cwd, head, candidate);
    for (const target of selected) {
      const env = {
        ...sharedEnv,
        CARGO_TARGET_DIR: path.resolve(
          cwd,
          sharedEnv.CARGO_TARGET_DIR ||
            path.join(path.dirname(target.manifest), "target"),
        ),
      };
      if (
        version(path.join(candidate, path.dirname(target.manifest)), env) !==
        toolchain
      )
        throw Error(
          `${target.manifest}: candidate snapshot selects a different Rust toolchain; activate the supported toolchain explicitly`,
        );
      const warnings = await cargoCheck(
        candidate,
        target,
        { ...env, GITHUB_SHA: head },
        "candidate",
      );
      if (!warnings.length) continue;
      if (!haveBaseline) {
        materialize(cwd, base, baseline);
        haveBaseline = true;
      }
      if (
        version(path.join(baseline, path.dirname(target.manifest)), env) !==
        toolchain
      )
        throw Error(
          `${target.manifest}: main snapshot selects a different Rust toolchain; activate the same supported toolchain for both revisions`,
        );
      const accepted = await cargoCheck(
        baseline,
        target,
        { ...env, GITHUB_SHA: base },
        `main ${base.slice(0, 12)}`,
      );
      const added = newWarnings(accepted, warnings);
      if (added.length)
        throw Error(
          "New Rust dead_code diagnostics:\n" +
            added
              .map((warning) => `${warning.location}: ${warning.message}`)
              .join("\n"),
        );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    await checkRust(process.cwd(), process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
