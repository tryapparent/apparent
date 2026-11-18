import path from "node:path";
import { analyze } from "../policy.ts";
import type { Edge } from "../runtime/contexts.ts";
import type { Snapshot } from "../snapshot.ts";

export const configName = /(?:^|\/)tsconfig(?:\.[^/]+)?\.json$/;
export const tsSource = /\.[cm]?tsx?$/;

export type Project = { config: string; root: string; lock: string };
type Rule = {
  config: string;
  inputs?: string[];
  dependencies?: string[];
  prepare?: string;
  declarations?: { config: string; package?: string }[];
};

export function within(file: string, dir: string): boolean {
  return dir === "." || file.startsWith(dir + "/");
}

function owns(file: string, owner: string): boolean {
  return (
    within(file, owner) ||
    (owner === "agent" && within(file, "capture/agent")) ||
    (owner === "composition" && within(file, "capture/desktop/ui/frontend"))
  );
}

export function rules(snapshot: Snapshot): Map<string, Rule> {
  const result = new Map<string, Rule>();
  for (const [file, source] of snapshot.files) {
    if (!/^[^/]+\/enablement\/ci\/typecheck\.json$/.test(file)) continue;
    for (const rule of JSON.parse(source) as Rule[]) {
      if (
        !owns(rule.config, file.split("/")[0]) ||
        !configName.test(rule.config) ||
        result.has(rule.config) ||
        !snapshot.files.has(rule.config)
      )
        throw Error(`Invalid typecheck declaration in ${file}: ${rule.config}`);
      result.set(rule.config, rule);
    }
  }
  return result;
}

export function inventory(snapshot: Snapshot): Project[] {
  return [...snapshot.files.keys()]
    .filter((file) => configName.test(file))
    .map((config) => {
      let root = path.posix.dirname(config);
      while (true) {
        for (const name of ["package-lock.json", "bun.lock"]) {
          const lock = root === "." ? name : root + "/" + name;
          if (snapshot.modes.has(lock)) return { config, root, lock };
        }
        const manifest = JSON.parse(
          snapshot.files.get(path.posix.join(root, "package.json")) ?? "{}",
        );
        if (
          root === "." ||
          manifest.devDependencies?.typescript ||
          manifest.dependencies?.typescript
        )
          throw Error(
            `${config}: TypeScript setup requires an owner package.json and a tracked npm or Bun lockfile`,
          );
        root = path.posix.dirname(root);
      }
    });
}

export function affectedFiles(
  changed: string[],
  ...snapshots: Snapshot[]
): Set<string> {
  const consumers = new Map<string, Set<string>>();
  for (const snapshot of snapshots) {
    const edges: Edge[] = [];
    analyze(snapshot, edges);
    for (const { from, target } of edges) {
      if (!target) continue;
      if (!consumers.has(target)) consumers.set(target, new Set());
      consumers.get(target)!.add(from);
    }
  }
  const affected = new Set(changed);
  for (const file of affected)
    for (const consumer of consumers.get(file) ?? []) affected.add(consumer);
  return affected;
}

export function selectProjects(
  staged: Snapshot,
  committed: Snapshot,
  changed: string[],
): Project[] {
  const candidates = inventory(staged);
  const declared = rules(staged);
  const affected = affectedFiles(changed, committed, staged);
  const routingChanged = changed.some((file) =>
    /^[^/]+\/enablement\/ci\/typecheck\.json$/.test(file),
  );
  return candidates.filter((project) => {
    const { config, root } = project;
    const rule = declared.get(config);
    const inputs = [
      config,
      project.lock,
      `${root}/package.json`,
      `${root}/.npmrc`,
      ...(rule?.inputs ?? []),
    ];
    return (
      routingChanged ||
      [...affected].some(
        (file) =>
          inputs.some((input) =>
            input.endsWith("/") ? file.startsWith(input) : file === input,
          ) ||
          ((tsSource.test(file) || configName.test(file)) &&
            within(file, path.posix.dirname(config))),
      )
    );
  });
}
