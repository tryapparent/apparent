import path from "node:path";
import { root as virtualRoot, type Snapshot } from "../snapshot.ts";
import { localPackages } from "./dependencies.ts";
import { compilerInputs } from "./inputs.ts";

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

const ruleFile = (owner: string) => owner + "/enablement/ci/typecheck.json";

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

export function selectProjects(
  staged: Snapshot,
  committed: Snapshot,
  changed: string[],
  required: string[] = [],
): Project[] {
  const affected = new Set(changed);
  const consumers = new Map<string, Set<string>>();
  const prefixes: [string, string][] = [];
  for (const snapshot of [committed, staged]) {
    const declared = rules(snapshot);
    const projects = inventory(snapshot);
    const packages = new Map(
      projects.map(({ root }) => [root, localPackages(snapshot, root)]),
    );
    for (const project of projects) {
      const { config, root, lock } = project;
      const rule = declared.get(config);
      const owner = config.startsWith("capture/desktop/")
        ? "composition"
        : config.startsWith("capture/agent/")
          ? "agent"
          : config.split("/")[0];
      const dependencies = [
        ...(rule?.dependencies ?? []),
        ...(rule?.declarations ?? []).map(({ config }) => config),
      ];
      const attached = [
        root,
        ...dependencies
          .map(
            (config) =>
              projects.find((project) => project.config === config)?.root,
          )
          .filter((root) => root !== undefined),
      ];
      const inputs = [
        ruleFile(owner),
        lock,
        ...[root, ...packages.get(root)!.values()].flatMap((dir) =>
          [
            "package.json",
            "package-lock.json",
            "bun.lock",
            ".npmrc",
            "bunfig.toml",
          ].map((file) => path.posix.join(dir, file)),
        ),
        ...(rule?.inputs ?? []),
        ...dependencies,
        ...compilerInputs(
          snapshot,
          virtualRoot,
          config,
          attached.map((dir) => ({
            dir,
            packages: packages.get(dir)!,
          })),
        ),
      ];
      for (const input of inputs) {
        if (input.endsWith("/")) prefixes.push([input, config]);
        else {
          if (!consumers.has(input)) consumers.set(input, new Set());
          consumers.get(input)!.add(config);
        }
      }
    }
  }
  for (const file of affected) {
    for (const config of consumers.get(file) ?? []) affected.add(config);
    for (const [prefix, config] of prefixes)
      if (file.startsWith(prefix)) affected.add(config);
  }
  const candidates = inventory(staged);
  for (const config of required)
    if (!candidates.some((project) => project.config === config))
      throw Error(`Missing configured typed promise lint project: ${config}`);
  return candidates.filter(
    ({ config }) => affected.has(config) || required.includes(config),
  );
}
