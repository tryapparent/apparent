import { createHash } from "node:crypto";
import { git } from "../snapshot.ts";

function matches(text: string): string[] {
  return (
    text.match(
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----|$)|\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
    ) ?? []
  );
}
export function secretCheck(
  cwd: string,
  head: string | undefined,
  tree: string,
): string[] {
  try {
    const errors: string[] = [];
    const before = new Set(
      head ? git(["ls-tree", "-rz", "--name-only", head], cwd).split("\0") : [],
    );
    for (const file of git(
      head
        ? [
            "diff",
            "--no-renames",
            "--diff-filter=ACMT",
            "--name-only",
            "-z",
            head,
            tree,
          ]
        : ["ls-tree", "-rz", "--name-only", tree],
      cwd,
    )
      .split("\0")
      .filter(Boolean)) {
      const text = git(["show", `${tree}:${file}`], cwd);
      const old = before.has(file) ? git(["show", `${head}:${file}`], cwd) : "";
      if (text === old) continue;
      const allowance = new Map<string, number>();
      for (const value of matches(old))
        allowance.set(value, (allowance.get(value) ?? 0) + 1);
      for (const value of matches(file + "\n" + text)) {
        const count = allowance.get(value) ?? 0;
        if (count) allowance.set(value, count - 1);
        else {
          errors.push(
            `Staged secret rejected in path-id ${createHash("sha256").update(file).digest("hex").slice(0, 12)}; inspect staged changes locally. Values and paths withheld.`,
          );
          break;
        }
      }
    }
    return errors;
  } catch {
    throw Error(
      "Cannot read staged secret-scan inputs; values and paths withheld. Check Git object/index availability locally.",
    );
  }
}
