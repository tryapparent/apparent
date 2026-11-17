import { analyze } from "../policy.ts";
import type { Edge } from "../runtime/contexts.ts";
import { materialize } from "./materialize.ts";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { Snapshot, git } from "../snapshot.ts";

const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
type Project = {
  root: string;
  inputs: string[];
  tests: string[];
  typecheck: boolean;
};
export function plan(snapshot: Snapshot, changed: string[]): Project[] {
  const projects: Project[] = [];
  for (const [file, text] of snapshot.files) {
    if (!/^[^/]+\/enablement\/ci\/fast.json$/.test(file)) continue;
    const manifest = JSON.parse(text) as { projects: Project[] };
    if (!Array.isArray(manifest.projects))
      throw Error("Invalid fast-check manifest");
    for (const project of manifest.projects) {
      if (
        !project.root.startsWith(file.split("/")[0] + "/") ||
        project.root.includes("..") ||
        !Array.isArray(project.tests) ||
        !project.tests.length ||
        project.tests.some(
          (test) => test.includes("..") || test.startsWith("/"),
        ) ||
        !Array.isArray(project.inputs)
      )
        throw Error("Invalid owner fast-check project");
      projects.push(project);
    }
  }
  if (!projects.length) return [];
  for (const project of projects)
    project.tests = [
      ...new Set([
        ...project.tests,
        ...changed
          .filter(
            (file) =>
              file.startsWith(project.root + "/") &&
              /\.test\.[cm]?ts$/.test(file) &&
              snapshot.modes.has(file),
          )
          .map((file) => file.slice(project.root.length + 1)),
      ]),
    ];
  const selected = projects.filter((project) =>
    changed.some(
      (file) =>
        file.startsWith(project.root + "/") || project.inputs.includes(file),
    ),
  );
  const unknown = changed.some(
    (file) =>
      !projects.some(
        (project) =>
          file.startsWith(project.root + "/") || project.inputs.includes(file),
      ),
  );
  if (unknown) return projects;
  const edges: Edge[] = [];
  analyze(snapshot, edges);
  let grew = true;
  while (grew) {
    grew = false;
    for (const project of projects) {
      if (selected.includes(project)) continue;
      const seen = new Set<string>();
      function affected(file: string): boolean {
        if (seen.has(file)) return false;
        seen.add(file);
        if (selected.some((project) => file.startsWith(project.root + "/")))
          return true;
        return edges.some(
          (edge) => edge.from === file && edge.target && affected(edge.target),
        );
      }
      if (
        [...snapshot.files.keys()].some(
          (file) => file.startsWith(project.root + "/") && affected(file),
        )
      ) {
        selected.push(project);
        grew = true;
      }
    }
  }
  return selected;
}
export async function fastChecks(
  cwd: string,
  head: string | undefined,
  tree: string,
  snapshot: Snapshot,
): Promise<void> {
  const changed = git(
    head
      ? ["diff", "--name-only", "--no-renames", "-z", head, tree]
      : ["ls-tree", "-rz", "--name-only", tree],
    cwd,
  )
    .split("\0")
    .filter(Boolean);
  const projects = plan(snapshot, changed);
  if (!projects.length) {
    console.error(
      "Fast checks: no declared project selected; staged syntax/graph checks still apply (no project typecheck claim)",
    );
    return;
  }
  const scratch = mkdtempSync("/tmp/apparent-dev-fast-");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_") &&
        ![
          "NODE_OPTIONS",
          "NODE_PATH",
          "NODE_TEST_CONTEXT",
          "NODE_V8_COVERAGE",
        ].includes(key),
    ),
  );
  try {
    materialize(cwd, tree, scratch);
    symlinkSync(
      path.join(tool, "node_modules"),
      path.join(scratch, "node_modules"),
      "dir",
    );
    const installed = JSON.parse(
      readFileSync(
        path.join(tool, "node_modules/typescript/package.json"),
        "utf8",
      ),
    );
    if (installed.version !== "5.9.3")
      throw Error(
        "Install pinned staged tools with npm ci --ignore-scripts --prefix shared/enablement/dependency-policy",
      );
    for (const project of projects) {
      const work = path.join(scratch, project.root);
      mkdirSync(work, { recursive: true });
      symlinkSync(
        path.join(tool, "node_modules"),
        path.join(work, "node_modules"),
        "dir",
      );
      const run = (args: string[]) => {
        const child = spawnSync(process.execPath, args, {
          cwd: work,
          env,
          encoding: "utf8",
          timeout: 120000,
          maxBuffer: 8 * 1024 * 1024,
        });
        if (child.status !== 0)
          throw Error(
            `Fast checks failed for ${project.root}: ${child.error?.message ?? child.stdout + child.stderr}`,
          );
      };
      if (project.typecheck) {
        run([
          path.join(tool, "node_modules/typescript/bin/tsc"),
          "--noEmit",
          "--incremental",
          "false",
        ]);
        const lint = new ESLint({
          cwd: work,
          overrideConfigFile: true,
          overrideConfig: [
            {
              files: ["**/*.ts"],
              languageOptions: {
                parser: tseslint.parser,
                parserOptions: {
                  project: "./tsconfig.json",
                  tsconfigRootDir: work,
                },
              },
              plugins: { "@typescript-eslint": tseslint.plugin },
              rules: {
                "@typescript-eslint/no-floating-promises": "error",
                "@typescript-eslint/no-misused-promises": "error",
              },
            },
          ],
        });
        const results = await lint.lintFiles(["src/**/*.ts"]);
        if (
          !results.length ||
          results.some((result) => result.errorCount || result.fatalErrorCount)
        )
          throw Error(
            `Typed promise lint failed for ${project.root}; run the owner typecheck and inspect unhandled/misused promises`,
          );
      }
      run(["--experimental-strip-types", "--test", ...project.tests]);
      console.error(
        `Fast checks: ${project.root}: ${project.typecheck ? "typecheck, typed promise lint, " : ""}${project.tests.length} focused test files passed`,
      );
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
