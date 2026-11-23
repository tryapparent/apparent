import { readFileSync } from "node:fs";

const source = new URL(
  "./dev.kitlangton.apparent.desktop.json",
  import.meta.url,
);
const lines: string[] = JSON.parse(readFileSync(source, "utf8"));
process.stdout.write(lines.join("\n") + "\n");
