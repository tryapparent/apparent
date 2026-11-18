import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export function materialize(cwd: string, tree: string, output: string): void {
  const entries = execFileSync("git", ["ls-tree", "-rz", tree], {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf("\t");
      const [mode, kind, hash] = entry.slice(0, tab).split(" ");
      return { mode, kind, hash, file: entry.slice(tab + 1) };
    })
    .filter((entry) => entry.kind === "blob" && entry.mode.startsWith("100"));
  const bytes = execFileSync("git", ["cat-file", "--batch"], {
    cwd,
    input: entries.map((entry) => entry.hash).join("\n") + "\n",
    maxBuffer: 256 * 1024 * 1024,
  });
  let offset = 0;
  for (const entry of entries) {
    if (
      path.posix.normalize(entry.file) !== entry.file ||
      entry.file.startsWith("/") ||
      entry.file.split("/").includes("..")
    )
      throw Error("Invalid staged snapshot path");
    const end = bytes.indexOf(10, offset);
    const [hash, kind, length] = bytes
      .subarray(offset, end)
      .toString()
      .split(" ");
    const size = Number(length);
    if (
      hash !== entry.hash ||
      kind !== "blob" ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      end + size + 2 > bytes.length
    )
      throw Error("Incomplete staged snapshot blob");
    const target = path.join(output, entry.file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, bytes.subarray(end + 1, end + size + 1), {
      mode: entry.mode === "100755" ? 0o700 : 0o600,
    });
    offset = end + size + 2;
  }
}
