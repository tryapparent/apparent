import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const names = ["short", "ink", "long"] as const;
type Shape = (typeof names)[number];
type Timed = { t0: number; t1: number; text: string };
type Index = {
  id: string;
  createdAtMs: number;
  durationMs: number;
  contactSheet: string;
  keyframes: {
    index: number;
    t: number;
    file: string;
    said?: string;
    displayTime?: string;
  }[];
  transcript: { text: string; segments: Timed[]; words: Timed[] };
  events: { t: number }[];
  strokes: unknown[];
  marks: unknown[];
};

const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");

function files(root: string, directory = root): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((leaf) => {
      const path = join(directory, leaf);
      const st = lstatSync(path);
      assert(
        st.isFile() || st.isDirectory(),
        "Fixtures must be plain files and directories",
      );
      return st.isDirectory() ? files(root, path) : [relative(root, path)];
    });
}

export function fingerprint(directory: string) {
  let bytes = 0;
  const entries = files(directory).map((leaf) => {
    const contents = readFileSync(join(directory, leaf));
    bytes += contents.length;
    return [leaf, digest(contents)];
  });
  return { bytes, sha256: digest(JSON.stringify(entries)) };
}

function evidencePath(bundle: string, leaf: string) {
  assert(!isAbsolute(leaf));
  const path = resolve(bundle, leaf);
  const diff = relative(bundle, path);
  assert(diff && diff !== ".." && !diff.startsWith("../") && !isAbsolute(diff));
  assert(
    files(bundle).includes(diff),
    "Evidence must be a regular file inside the bundle",
  );
  return path;
}

export function demoFixtures(
  root: string,
  producer: (path: string) => void,
): Record<Shape, string> {
  const demo = join(root, "producer.apparent");
  producer(demo);
  const paths = Object.fromEntries(
    names.map((kind) => [kind, join(root, kind + ".apparent")]),
  ) as Record<Shape, string>;
  for (const kind of names) {
    const bundle = paths[kind];
    cpSync(demo, bundle, { recursive: true, errorOnExist: true, force: false });
    const manifest = join(bundle, "apparent.json");
    const index: Index = JSON.parse(readFileSync(manifest, "utf8"));
    index.id = "synthetic-agent-inspect-" + kind;
    index.createdAtMs = 0;
    if (kind === "short") {
      index.events = [];
      index.strokes = [];
      index.marks = [];
    }
    if (kind === "long") {
      const chapter = index.durationMs;
      const offsets = Array.from(
        { length: Math.ceil(300_000 / chapter) },
        (_, i) => i * chapter,
      );
      const repeat = (units: Timed[]) =>
        offsets.flatMap((offset) =>
          units.map((unit) => ({
            ...unit,
            t0: unit.t0 + offset,
            t1: unit.t1 + offset,
          })),
        );
      index.transcript.words = repeat(index.transcript.words);
      index.transcript.segments = repeat(index.transcript.segments);
      index.transcript.text = offsets
        .map(() => index.transcript.text)
        .join(" ");
      index.events = offsets.flatMap((offset) =>
        index.events.map((event) => ({ ...event, t: event.t + offset })),
      );
      const count = index.keyframes.length;
      index.keyframes = offsets.flatMap((offset, chapter) =>
        index.keyframes.map(({ displayTime, ...frame }) => ({
          ...frame,
          index: frame.index + chapter * count,
          t: frame.t + offset,
        })),
      );
      index.durationMs = offsets.length * chapter;
    }
    writeFileSync(manifest, JSON.stringify(index) + "\n", { mode: 0o600 });
  }
  return paths;
}

export function loadFixtures(
  paths: Record<Shape, string>,
  decode: (path: string) => void,
) {
  return names.map((name) => {
    const bundle = paths[name];
    assert(
      isAbsolute(bundle) &&
        lstatSync(bundle).isDirectory() &&
        bundle.endsWith(".apparent"),
    );
    const fingerprintBefore = fingerprint(bundle);
    const index: Index = JSON.parse(
      readFileSync(join(bundle, "apparent.json"), "utf8"),
    );
    const first = index.keyframes.find((frame) => frame.said?.trim());
    const last = index.keyframes.findLast((frame) => frame.said?.trim());
    assert(first?.said && last?.said, "Expected timed synthetic narration");
    const images = [...new Set([index.contactSheet, first.file, last.file])];
    for (const leaf of images) decode(evidencePath(bundle, leaf));
    return {
      name,
      bundle,
      fingerprint: fingerprintBefore,
      images,
      verify(summary: string) {
        assert(
          summary.startsWith("[apparent ") &&
            summary.split("\n", 1)[0].endsWith(bundle + "]"),
          "Summary missing its source bundle",
        );
        assert(
          summary.includes(first.said!.trim()) &&
            summary.includes(last.said!.trim()),
          "Summary missing timed narration",
        );
        assert(
          summary.includes(first.displayTime ?? "- #" + first.index + " ("),
          "Summary missing first spoken keyframe",
        );
        assert(
          summary.includes(last.displayTime ?? "- #" + last.index + " ("),
          "Summary missing last spoken keyframe",
        );
        return digest(summary);
      },
    };
  });
}
