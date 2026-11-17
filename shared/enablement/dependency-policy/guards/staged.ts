import path from "node:path";
import { tokens, sourceBudget, lockfiles } from "./budgets.ts";
export { tokens } from "./budgets.ts";
import { git } from "../snapshot.ts";
import { checkStyles } from "./style.ts";

export async function checkStaged(
  cwd: string,
  head: string | undefined,
  tree: string,
): Promise<string[]> {
  const before = new Map<string, string>();
  const after = new Map<string, string>();
  for (const [ref, entries] of [
    [head, before],
    [tree, after],
  ] as const) {
    if (!ref) continue;
    for (const row of git(["ls-tree", "-rz", ref], cwd)
      .split("\0")
      .filter(Boolean)) {
      const tab = row.indexOf("\t");
      entries.set(row.slice(tab + 1), row.slice(0, tab));
    }
  }
  const renames = new Map<string, string>();
  if (head) {
    const fields = git(
      ["diff", "--name-status", "-z", "--find-renames=100%", head, tree, "--"],
      cwd,
    ).split("\0");
    for (let i = 0; i < fields.length && fields[i]; ) {
      const status = fields[i++],
        old = fields[i++];
      if (status.startsWith("R")) {
        const next = fields[i++];
        if (
          status === "R100" &&
          !after.has(old) &&
          !before.has(next) &&
          before.get(old) === after.get(next)
        )
          renames.set(next, old);
      } else if (status.startsWith("C")) i++;
    }
  }
  const errors: string[] = [];
  const style: { file: string; text: string; old?: string }[] = [];
  for (const [file, meta] of after) {
    if (meta === before.get(file) || !meta.startsWith("100")) continue;
    const text = git(["show", `${tree}:${file}`], cwd);
    const old = before.has(file)
      ? git(["show", `${head}:${file}`], cwd)
      : undefined;
    const renamed = renames.get(file);
    const inherited =
      old ?? (renamed ? git(["show", head + ":" + renamed], cwd) : undefined);
    errors.push(...sourceBudget(file, text, inherited));
    const ext = path.posix.extname(file).toLowerCase();
    const base = path.posix.basename(file);
    if (ext === ".md") {
      const cap = (
        { "agents.md": 2000, "readme.md": 2000, "skill.md": 3000 } as Record<
          string,
          number
        >
      )[base.toLowerCase()];
      const count = tokens(text);
      if (
        old === undefined &&
        (!cap || !["AGENTS.md", "README.md", "SKILL.md"].includes(base))
      )
        errors.push(
          `${file}: new Markdown must be named AGENTS.md, README.md or SKILL.md with canonical case`,
        );
      if (
        cap
          ? count > Math.max(cap, old === undefined ? 0 : tokens(old))
          : old === undefined || count > tokens(old)
      )
        errors.push(
          `${file}: ${count} Markdown tokens exceed ${cap ? "cap/inherited allowance" : "other-name no-growth allowance"} (${old === undefined ? (cap ?? 0) : cap ? Math.max(cap, tokens(old)) : tokens(old)})`,
        );
    }
    const python = /\bpython(?:[23](?:\.\d+)?)?\b/.test(text.split("\n")[0]);
    if (old === undefined) {
      if (
        (ext === ".py" || (text.startsWith("#!") && python)) &&
        !file.startsWith("hermes/")
      )
        errors.push(`${file}: new Python is allowed only in hermes/`);
      else if (ext === ".rs" && !file.startsWith("engine/"))
        errors.push(`${file}: new Rust is allowed only in engine/`);
      else if (
        [".js", ".jsx", ".mjs", ".cjs"].includes(ext) ||
        (text.startsWith("#!") &&
          /\bnode\b/.test(text.split("\n")[0]) &&
          ![".ts", ".tsx", ".mts", ".cts"].includes(ext))
      )
        errors.push(
          `${file}: new authored JavaScript is forbidden; use TypeScript`,
        );
      else if (
        [
          ".swift",
          ".sh",
          ".bash",
          ".c",
          ".h",
          ".m",
          ".mm",
          ".cpp",
          ".cc",
        ].includes(ext) ||
        (text.startsWith("#!") &&
          !(python && file.startsWith("hermes/")) &&
          ![".ts", ".tsx", ".mts", ".cts", ".py"].includes(ext))
      )
        errors.push(
          `${file}: new native/shell executable requires an exact reviewed policy allowance; use TypeScript by default`,
        );
    }
    if (!lockfiles.has(base) && /\.(?:[cm]?[jt]sx?|css|jsonc?)$/i.test(file))
      style.push({ file, text, old: inherited });
  }
  errors.push(...checkStyles(style));
  return errors;
}
