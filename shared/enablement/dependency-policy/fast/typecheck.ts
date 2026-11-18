import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import type { Snapshot } from "../snapshot.ts";
import {
  attachModules,
  cacheRoot,
  command,
  localPackages,
  lockedDependencies,
} from "./dependencies.ts";
import { materialize } from "./materialize.ts";
import {
  inventory,
  rules,
  selectProjects,
  tsSource,
  type Project,
} from "./projects.ts";

type SnapshotInput = {
  cwd: string;
  tree: string;
  staged: Snapshot;
  committed: Snapshot;
  changed: string[];
};

export async function typechecks(
  input: SnapshotInput,
  options: {
    setup?: boolean;
    all?: boolean;
    lint?: (project: Project, work: string) => Promise<void>;
  } = {},
): Promise<void> {
  const { cwd, tree, staged, committed, changed } = input;
  const projects = options.all
    ? inventory(staged)
    : selectProjects(staged, committed, changed);
  const uncovered = new Set(
    changed.filter((file) => tsSource.test(file) && staged.modes.has(file)),
  );
  if (projects.length) {
    const scratch = mkdtempSync(path.join(cacheRoot(cwd), "snapshot-"));
    const declared = rules(staged);
    const byConfig = new Map(
      inventory(staged).map((project) => [project.config, project]),
    );
    try {
      for (
        let ancestor = path.dirname(scratch);
        ancestor !== "/";
        ancestor = path.dirname(ancestor)
      )
        if (existsSync(path.join(ancestor, "node_modules")))
          throw Error(
            `TypeScript snapshot would inherit dependencies from ${ancestor}/node_modules`,
          );
      materialize(cwd, tree, scratch);
      for (const project of projects) {
        const start = performance.now();
        const attached = new Set<string>();
        const outputs = new Set<string>();
        const work = path.join(scratch, project.root);
        const compiler = (item: Project) => {
          const dir = path.join(scratch, item.root);
          const dest = path.join(dir, "node_modules");
          const locked = lockedDependencies(
            cwd,
            tree,
            staged,
            item,
            dir,
            options.setup,
          );
          if (!attached.has(dest)) {
            attachModules(
              locked,
              dest,
              localPackages(staged, item.root),
              scratch,
            );
            attached.add(dest);
          }
          return path.join(dest, ".bin/tsc");
        };
        try {
          const tsc = compiler(project);
          for (const dependency of declared.get(project.config)?.dependencies ??
            []) {
            const item = byConfig.get(dependency);
            if (!item)
              throw Error(
                `${dependency}: missing declared dependency configuration`,
              );
            compiler(item);
          }
          for (const producer of declared.get(project.config)?.declarations ??
            []) {
            const dependency = byConfig.get(producer.config);
            if (!dependency)
              throw Error(
                `${producer.config}: missing declaration producer config`,
              );
            const build = compiler(dependency);
            if (options.setup) continue;
            const source = path.join(scratch, dependency.root, "dist");
            const destination = producer.package
              ? path.join(work, "node_modules", producer.package, "dist")
              : source;
            const packageRoot =
              producer.package &&
              localPackages(staged, project.root).get(producer.package);
            if (producer.package && packageRoot !== dependency.root)
              throw Error(
                `${project.config}: ${producer.package} must be a local dependency from ${dependency.root}`,
              );
            outputs.add(destination);
            command(
              build,
              [
                "--project",
                path.join(scratch, producer.config),
                "--outDir",
                destination,
                "--emitDeclarationOnly",
                "--pretty",
                "false",
              ],
              path.join(scratch, dependency.root),
            );
          }
          if (options.setup) continue;
          const prepare = declared.get(project.config)?.prepare;
          if (prepare)
            command("npm", ["run", "--ignore-scripts", prepare], work);
          const files = command(
            tsc,
            [
              "--project",
              path.join(scratch, project.config),
              "--noEmit",
              "--pretty",
              "false",
              "--listFiles",
            ],
            work,
          );
          const sources = localPackages(staged, project.root);
          for (const file of files.split("\n")) {
            const relative = path.relative(scratch, file.trim());
            uncovered.delete(relative);
            for (const [name, dir] of sources) {
              const prefix =
                path.join(project.root, "node_modules", name) + "/";
              if (relative.startsWith(prefix))
                uncovered.delete(path.join(dir, relative.slice(prefix.length)));
            }
          }
          await options.lint?.(project, work);
          console.error(
            `Staged TypeScript: ${project.config} passed (${Math.round(performance.now() - start)} ms)`,
          );
        } catch (error) {
          throw Error(
            `Staged TypeScript ${project.config}: ${String(error).replaceAll(scratch + "/", "")}`,
          );
        } finally {
          for (const output of outputs)
            rmSync(output, { recursive: true, force: true });
          for (const dest of attached)
            rmSync(dest, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  if (!options.setup && uncovered.size) {
    console.error(
      "Staged TypeScript files outside the selected compiler inputs (syntax/graph and applicable owner tests only):",
    );
    for (const file of uncovered) console.error(`  ${file}`);
  }
}
