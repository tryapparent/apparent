import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";

export function traceAdmission(directory: string): string[] {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
        import { default as policy } from "./admission.mjs";
        console.log(JSON.stringify(Array.from({ length: 8 }, (_, index) =>
          policy.admit(Boolean(index & 1), Boolean(index & 2), Boolean(index & 4)).$)));
      `,
      ],
      { cwd: directory, encoding: "utf8" },
    ),
  );
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  await bendScratch(async (directory) => {
    await buildBend(root, "agent", directory, undefined, "agent/trace/");
    const admission = traceAdmission(directory);
    for (const decision of admission)
      assert.ok(["Disabled", "Closed", "Full", "Begin"].includes(decision));
    process.stdout.write(
      `const ADMISSION: [Admission; 8] = [${admission.map((decision) => `Admission::${decision}`).join(", ")}];\n`,
    );
  });
}
