import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { bendComments } from "./source.ts";

const revision = "9c586f094f4fc88bef440dc8b4d77a2f92c257cc";
const upstream = `https://raw.githubusercontent.com/bendlang/bend/${revision}/bend2`;
const sources = {
  "main.ts": "a9caec19d6d42a3c6314766170db05fd47bbbc5fcc71207c9aadbbaad51d83ec",
  "bend.ts": "24e424ae6a540bd8930a26b8e87a270d2be7c16835a3dbf85adc43348b0ce6e6",
  "comp.ts": "d5e46919252986ff1469c2c8e462bb1c8bb6daa339f0d76e38b9d7efa105ed00",
  "safe.ts": "8f5d72dd6fe5adb612e5276d15d7648a98d113d8df343b675721399d23a2b36c",
  "base.bend":
    "9a457145eacff52a36340cf86400b64b94b6eccc124c8ef3cf48bba4eab29af0",
  "bendtt.lean":
    "3e9b678d00a754fc6f4281584e470f7c677093b03eccfc244085afdee8e020a6",
};

export function run(
  program: string,
  args: string[],
  cwd: string,
  env = process.env,
  timeout = 60_000,
): string {
  try {
    return execFileSync(program, args, {
      cwd,
      env,
      timeout,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(
      `${program}: ${failure.stderr?.trim() || failure.stdout?.trim() || failure.message}`,
    );
  }
}

export async function provisionLean(scratch: string): Promise<string> {
  if (process.platform !== "linux" || process.arch !== "x64")
    throw new Error(
      "Automatic Lean provisioning requires Linux x64. Use --lean-bin for another platform.",
    );
  const release = "lean-4.34.0-linux";
  const archive = join(scratch, release + ".tar.zst");
  run(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--retry",
      "2",
      "--max-time",
      "150",
      "--output",
      archive,
      "https://github.com/leanprover/lean4/releases/download/v4.34.0/" +
        basename(archive),
    ],
    scratch,
    process.env,
    180_000,
  );
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (
    hash.digest("hex") !==
    "caaa98356098c85dc0fcbbd28e1ec66f39eb6551829972b752ff20e1286b646b"
  )
    throw new Error("Lean 4.34.0 archive integrity check failed");
  run("tar", ["--zstd", "-xf", archive], scratch, process.env, 120_000);
  return join(scratch, release, "bin");
}

export async function prepareBend(
  scratch: string,
  options: { runtime: "node" } | { runtime: "bun"; leanDirectory?: string },
) {
  const leanDirectory =
    options.runtime === "bun" ? options.leanDirectory : undefined;
  if (options.runtime === "bun") {
    const version = run("bun", ["--version"], scratch).trim();
    if (version !== "1.3.10")
      throw new Error(`Bend tooling requires Bun 1.3.10, found ${version}`);
  }
  const compiler = join(scratch, "bend2");
  mkdirSync(compiler);
  const verified = await Promise.all(
    Object.entries(sources)
      .filter(([file]) => leanDirectory || file !== "bendtt.lean")
      .map(async ([file, digest]) => {
        const response = await fetch(`${upstream}/${file}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          throw new Error(
            `Bend toolchain download failed for ${file}: ${response.status}`,
          );
        const bytes = Buffer.from(await response.arrayBuffer());
        if (createHash("sha256").update(bytes).digest("hex") !== digest)
          throw new Error(`Bend toolchain integrity check failed for ${file}`);
        return { file, bytes };
      }),
  );
  for (const { file, bytes } of verified)
    writeFileSync(join(compiler, file), bytes, { flag: "wx" });
  const env = {
    ...process.env,
    TMPDIR: scratch,
    BEND_NO_TELEMETRY: "1",
    BEND_LIB: join(scratch, "bend-lib"),
    BEND_HUB: "http://127.0.0.1:1",
    BENDTT: "",
  };
  if (leanDirectory) {
    const lean = join(leanDirectory, "lean");
    const leanc = join(leanDirectory, "leanc");
    if (
      !/^Lean \(version 4\.34\.0[,)]/.test(run(lean, ["--version"], compiler))
    )
      throw new Error("BendTT requires Lean 4.34.0");
    run(lean, ["-c", "bendtt.c", "bendtt.lean"], compiler, env, 180_000);
    run(
      leanc,
      ["-O3", "-DNDEBUG", "bendtt.c", "-o", "bendtt"],
      compiler,
      env,
      180_000,
    );
    env.BENDTT = join(compiler, "bendtt");
  }
  return (input: string, output: string) => {
    const source = readFileSync(input, "utf8");
    bendComments(input, source);
    const stagedSource = join(
      mkdtempSync(join(scratch, "source-")),
      basename(input),
    );
    writeFileSync(stagedSource, source, { flag: "wx" });
    if (options.runtime === "node") {
      run(
        process.execPath,
        [
          "--experimental-transform-types",
          "--input-type=module",
          "-e",
          `
import { load } from "./main.ts";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
const [input, output] = process.argv.slice(1);
const { source } = await load(pathToFileURL(input).href, null, () => {
  throw new Error("Expected Bend source");
});
writeFileSync(output, source);
`,
          stagedSource,
          output,
        ],
        compiler,
        env,
      );
      return;
    }
    const command = (args: string[]) =>
      run(
        "bun",
        [join(compiler, "main.ts"), stagedSource, ...args],
        scratch,
        env,
      );
    const verdict = command([leanDirectory ? "--verdict" : "--check-only"]);
    if (!verdict.split("\n").includes("ALL PROOFS CHECK"))
      throw new Error(`Expected Bend verdict for ${input}: ${verdict}`);
    command(["-o", output]);
  };
}
