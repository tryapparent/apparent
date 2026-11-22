import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const [binary, work, manifest, ...extra] = process.argv.slice(2);
if (
  !binary ||
  !isAbsolute(binary) ||
  !work ||
  !isAbsolute(work) ||
  !manifest ||
  extra.length
) {
  throw new Error(
    "Usage: node enablement/timing/journey/local-cli.ts ABSOLUTE_BINARY ABSOLUTE_PRIVATE_WORK_DIR FIXTURES.json",
  );
}

const { short, ink, long } = JSON.parse(
  readFileSync(manifest, "utf8"),
) as Record<string, string>;
const inputs = [
  ["short", "quick-voice", short],
  ["ink", "editor-nine-strokes", ink],
  ["long", "long-narration", long],
];
const run = (program: string, args: string[], cwd = work, env = process.env) =>
  execFileSync(program, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
const job = mkdtempSync(join(work, "cli-"));
const env = { ...process.env, TMPDIR: job };
const version = run(binary, ["--version"], job, env).trim();
const waits: Record<string, { ms: number; verified: true }> = {};

function benchmark(
  id: string,
  args: string[],
  verify: (stdout: string) => void,
) {
  const start = performance.now();
  const stdout = run(binary, args, job, env);
  const elapsed = performance.now() - start;
  verify(stdout);
  waits[id] = { ms: elapsed, verified: true };
}

function decode(path: string) {
  run(
    "ffmpeg",
    ["-nostdin", "-v", "error", "-xerror", "-i", path, "-f", "null", "-"],
    job,
  );
}

function imagePath(container: string, leaf: string) {
  const path = resolve(container, leaf);
  const fromContainer = relative(container, path);
  if (
    !fromContainer ||
    fromContainer.startsWith("../") ||
    isAbsolute(fromContainer)
  ) {
    throw new Error("Evidence path escaped the fixture");
  }
  return path;
}

const outputBefore = (directory: string) =>
  new Set(readdirSync(directory, { recursive: true, encoding: "utf8" }));
function newPngs(directory: string, previous: Set<string>) {
  return readdirSync(directory, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".png") && !previous.has(file),
  );
}

for (const [shape, id, source] of inputs) {
  if (!source || !isAbsolute(source))
    throw new Error("Expected absolute fixture path for " + shape);
  const bundle = join(job, shape + ".apparent");
  cpSync(source, bundle, { recursive: true, force: false, errorOnExist: true });
  const index = JSON.parse(readFileSync(join(bundle, "apparent.json"), "utf8"));
  const sheet = index.contactSheet;
  if (typeof sheet !== "string" || !sheet.endsWith(".png"))
    throw new Error("Missing referenced contact sheet");
  benchmark("inspect-local/" + id, ["inspect", bundle], (summary) => {
    if (!summary.startsWith("[apparent ") || !summary.includes(bundle))
      throw new Error("Wrong or incomplete summary");
    decode(imagePath(bundle, sheet));
    const firstFrame = index.keyframes?.[0]?.file;
    if (typeof firstFrame === "string") {
      decode(imagePath(bundle, firstFrame));
    }
  });
  let previous = outputBefore(bundle);
  benchmark("extract/zoom-" + shape, ["zoom", "--at", "3", bundle], () => {
    const generated = newPngs(bundle, previous);
    if (generated.length !== 1)
      throw new Error("Expected one newly generated zoom sheet");
    decode(imagePath(bundle, generated[0]));
  });
  previous = outputBefore(bundle);
  benchmark(
    "extract/frames-" + shape,
    ["frames", "--from", "2", "--to", "3", "--fps", "4", bundle],
    () => {
      const generated = newPngs(bundle, previous);
      if (generated.length !== 4)
        throw new Error("Expected four newly extracted frames");
      for (const frame of generated) decode(imagePath(bundle, frame));
    },
  );
  if (shape === "ink") {
    const video = join(job, "export.mp4");
    benchmark("export", ["export", bundle, "--out", video], () =>
      decode(video),
    );
  }
}
writeFileSync(
  join(job, "cli-waits.json"),
  JSON.stringify({ version, waits }, null, 2) + "\n",
  { mode: 0o600 },
);
console.log(join(job, "cli-waits.json"));
