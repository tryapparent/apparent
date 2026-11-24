import { execFileSync } from "node:child_process";
import path from "node:path";

const connectRustMoves = new Map([
  ["connect/client/src/renewal/mod.rs", "connect/client/src/renewal.rs"],
  [
    "connect/client/src/test_support/mod.rs",
    "connect/client/src/test_support.rs",
  ],
]);

const source =
  /\.(?:[cm]?[jt]sx?|bend|rs|py|swift|sh|bash|zsh|css|html?|c|h|cc|cpp|cxx|hpp|hh|m|mm|metal)$/i;

function nonblankLines(text: string): number {
  return text.split("\n").filter((line) => line.trim()).length;
}

export function architectureErrors(
  cwd: string,
  base: string | undefined,
  candidate: string,
): string[] {
  const git = (...args: string[]) =>
    execFileSync("git", ["--no-replace-objects", ...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
  const baseline = base ?? git("hash-object", "-t", "tree", "--stdin").trim();
  const changes = git(
    "diff",
    "--raw",
    "--no-renames",
    "--no-abbrev",
    "-z",
    baseline,
    candidate,
    "--",
  ).split("\0");
  const errors: string[] = [];
  for (let index = 0; index < changes.length - 1; index += 2) {
    const file = changes[index + 1];
    const capture = file.startsWith("capture/");
    const [oldMode, mode, oldBlob, blob, status] = changes[index]
      .slice(1)
      .split(" ");
    if (capture && status === "A") {
      errors.push(
        `${file}: capture/ is frozen; put new paths in the canonical owner`,
      );
    } else if (capture && status === "T") {
      errors.push(
        `${file}: capture/ is frozen; move file-type changes to the canonical owner`,
      );
    } else if (capture && oldMode.startsWith("100") && mode.startsWith("100")) {
      const knownSource = source.test(file);
      if (!knownSource && path.posix.extname(file)) continue;
      const text = git("cat-file", "blob", blob);
      const old = git("cat-file", "blob", oldBlob);
      if (!knownSource && !text.startsWith("#!") && !old.startsWith("#!"))
        continue;
      const before = nonblankLines(old);
      const after = nonblankLines(text);
      if (after > before) {
        errors.push(
          `${file}: frozen capture/ source grew from ${before} to ${after} nonblank lines; move the changed logic to its canonical owner`,
        );
      }
    } else if (
      status === "A" &&
      /\.rs$/i.test(file) &&
      !file.startsWith("engine/")
    ) {
      const previous = connectRustMoves.get(file);
      const exactMove =
        previous &&
        git("ls-tree", "-z", baseline, "--", previous) ===
          `${mode} blob ${blob}\t${previous}\0` &&
        !git("ls-tree", "-z", candidate, "--", previous);
      if (!exactMove)
        errors.push(`${file}: new Rust is allowed only in engine/`);
    }
  }
  return errors;
}

if (import.meta.main) {
  const [base, candidate] = process.argv.slice(2);
  if (!base || !candidate || process.argv.length !== 4) {
    throw Error("Usage: architecture.ts <base tree> <candidate tree>");
  }
  const errors = architectureErrors(process.cwd(), base, candidate);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}
