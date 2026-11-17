import path from "node:path";
import { createHash } from "node:crypto";
import { analyze } from "../policy.ts";
import type { Edge } from "./contexts.ts";
import { parse } from "yaml";
import { Snapshot, owner } from "../snapshot.ts";

const workflows: Record<string, string> = {
  "stream-public.yml": "Public",
  "stream-connect.yml": "Connect",
  "stream-engine.yml": "Engine",
  "hermes.yml": "Hermes",
};
const coordinators = new Set([
  "checks.yml",
  "verification.yml",
  "verification-platform.yml",
  "linux-updater-harness.yml",
  "release-linux.yml",
  "release-mac-preview.yml",
  "release-windows.yml",
]);
export function ciPolicy(snapshot: Snapshot): Set<string> {
  const problems = new Set<string>();
  const active = new Set<string>();
  const declared = new Set<string>();
  for (const file of snapshot.modes.keys()) {
    const match =
      /^(onboarding|record|handoff|connect|agent|public|hermes|engine)\/(?!enablement\/).+\.(?:[cm]?[jt]sx?|rs|py|swift)$/.exec(
        file,
      );
    if (match) active.add(match[1]);
  }
  const visited = new Set<string>();
  const edges: Edge[] = [];
  analyze(snapshot, edges);
  const walked = new Set<string>();
  function walk(file: string, expected?: string) {
    const key = expected + ":" + file;
    if (walked.has(key)) return;
    walked.add(key);
    const source = snapshot.files.get(file);
    if (source && /\.(sh|py)$/.test(file)) command(file, source, expected, ".");
    for (const edge of edges.filter((edge) => edge.from === file)) {
      if (!edge.target) continue;
      const actual = owner(edge.target);
      if (expected && !actual)
        problems.add(
          file +
            " -> " +
            edge.target +
            ": stream CI cannot forward policy to an unowned root module",
        );
      if (expected && actual && actual !== expected && actual !== "Shared")
        problems.add(
          file +
            " -> " +
            edge.target +
            ": stream-private CI import crosses owners",
        );
      if (
        actual &&
        !["Shared", "Composition", "Legacy"].includes(actual) &&
        edge.target.includes("/enablement/") &&
        !edge.target.includes("/enablement/ci/")
      )
        problems.add(
          file +
            " -> " +
            edge.target +
            " [" +
            createHash("sha256")
              .update(snapshot.files.get(edge.target) ?? "")
              .digest("hex") +
            "]: stream CI dependencies belong in <stream>/enablement/ci",
        );
      walk(edge.target, expected);
    }
  }
  function command(origin: string, text: string, expected?: string, cwd = ".") {
    const identity = `${origin} [${cwd}]: ${text}`;
    if (visited.has(identity)) return;
    visited.add(identity);
    if (/\$\(|`|\beval\b|(?:^|[\n;&|])\s*cd\s/.test(text))
      problems.add(
        `${identity}: unsupported dynamic CI command; use an owner CI entrypoint`,
      );
    if (
      expected &&
      /\b(?:cargo|npm|bun|pnpm|yarn|rustc|tsc|docker|if|for|while|case)\b/.test(
        text,
      ) &&
      !text.includes(expected.toLowerCase() + "/enablement/ci/")
    )
      problems.add(
        identity +
          ": stream build/test policy must invoke its canonical CI entrypoint",
      );
    for (const token of text.matchAll(
      /(?:^|[\s"'])([\w./-]+\.(?:[cm]?[jt]s|sh|py))(?:[\s"']|$)/g,
    )) {
      const file = path.posix.normalize(path.posix.join(cwd, token[1]));
      if (!snapshot.modes.has(file)) {
        problems.add(`${identity}: unresolved CI command path ${file}`);
        continue;
      }
      const actual = owner(file);
      if (expected && !actual)
        problems.add(
          `${origin} -> ${file}: stream CI cannot forward policy to an unowned root script`,
        );
      walk(file, expected ?? actual);
      if (actual && !["Shared", "Composition", "Legacy"].includes(actual)) {
        if (
          !file.includes("/enablement/ci/") &&
          !/(?:\/tests?\/|\.test\.[cm]?[jt]s$)/.test(file)
        )
          problems.add(
            `${origin} -> ${file} [${createHash("sha256")
              .update(snapshot.files.get(file) ?? "")
              .digest(
                "hex",
              )}]: stream CI entrypoints belong in <stream>/enablement/ci`,
          );
        if (expected && actual !== expected)
          problems.add(
            `${origin} -> ${file}: stream-private CI dependency crosses owners`,
          );
      }
      const source = snapshot.files.get(file);
      if (source && /\.(sh|py)$/.test(file))
        command(file, source, actual ?? expected, cwd);
    }
    for (const match of text.matchAll(
      /npm\s+(?:--prefix\s+([\w./-]+)\s+)?run\s+([\w:-]+)/g,
    )) {
      const directory = path.posix.join(cwd, match[1] ?? ".");
      const file = path.posix.join(directory, "package.json");
      const raw = snapshot.files.get(file);
      const script = raw && snapshot.json(file, raw)?.scripts?.[match[2]];
      if (typeof script !== "string")
        problems.add(`${identity}: unresolved package command`);
      else command(file, script, expected, directory);
    }
  }
  for (const [file, text] of snapshot.files) {
    if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(file)) continue;
    const workflow = parse(text);
    const basename = file.split("/").at(-1)!;
    const named =
      /^stream-(onboarding|record|handoff|connect|agent|public|hermes|engine)\.ya?ml$/.exec(
        basename,
      )?.[1];
    const expected =
      workflows[basename] ?? (named && named[0].toUpperCase() + named.slice(1));
    if (expected) declared.add(expected.toLowerCase());
    if (!expected && !coordinators.has(basename))
      problems.add(
        file +
          ": workflow must name its owner as stream-<owner>.yml; shared coordinators require explicit admission",
      );
    const visit = (value: unknown, cwd = ".") => {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      const directory = object["working-directory"];
      if (directory !== undefined) {
        if (
          typeof directory !== "string" ||
          directory.includes("$") ||
          path.posix.isAbsolute(directory) ||
          directory.split("/").includes("..")
        )
          problems.add(file + ": unsupported CI working-directory");
        else cwd = directory;
      }
      for (const [key, child] of Object.entries(value)) {
        if (
          key === "uses" &&
          typeof child === "string" &&
          child.startsWith("./")
        ) {
          const local = path.posix.normalize(child);
          const action = [
            local + "/action.yml",
            local + "/action.yaml",
            local,
          ].find((file) => snapshot.files.has(file));
          if (!action)
            problems.add(file + ": unresolved local CI action/workflow");
          else
            problems.add(
              file +
                " -> " +
                action +
                " [" +
                createHash("sha256")
                  .update(snapshot.files.get(action)!)
                  .digest("hex") +
                "]: local action execution is unsupported; invoke an owner CI entrypoint",
            );
        } else if (key === "run" && typeof child === "string")
          command(file, child, expected ?? owner(cwd + "/"), cwd);
        else if (
          key === "paths" &&
          Array.isArray(child) &&
          child.some(
            (path) =>
              typeof path === "string" &&
              /^\.github\/(?:\*|workflows\/\*)/.test(path),
          )
        )
          problems.add(
            `${file}: blanket workflow selector fans out to unrelated owners`,
          );
        else visit(child, cwd);
      }
    };
    visit(workflow);
  }
  for (const stream of active)
    if (!declared.has(stream))
      problems.add(
        stream + ": active stream requires its own stream-<owner>.yml workflow",
      );
  return problems;
}
