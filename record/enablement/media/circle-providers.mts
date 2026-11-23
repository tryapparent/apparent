import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const media = fileURLToPath(new URL("../../media/", import.meta.url));
const out = join(media, "dist/circle");
mkdirSync(out, { recursive: true });
const stage = mkdtempSync(join(out, ".providers-"));
try {
  for (const name of ["ocr", "vision"]) {
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        join(media, "circle-" + name, "build.ts"),
        join(stage, name),
      ],
      { stdio: "inherit" },
    );
  }
  for (const name of ["ocr", "vision"]) {
    rmSync(join(out, name), { recursive: true, force: true });
    renameSync(join(stage, name), join(out, name));
  }
} finally {
  rmSync(stage, { recursive: true, force: true });
}
