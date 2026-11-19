import { readFileSync } from "node:fs";
import { recordingPermissions } from "../../capture-request/src/permission-requirements.ts";

for (const platform of ["macos", "macosPicker", "linux"] as const) {
  const modes = recordingPermissions[platform];
  const name =
    platform === "macosPicker" ? "MACOS_PICKER" : platform.toUpperCase();
  const requirements = [modes.silent, modes.narrated].map(
    (permissions) =>
      `&[${permissions.map((permission) => `Permission::${permission}`).join(", ")}]`,
  );
  const target =
    platform === "linux" ? 'not(target_os = "macos")' : 'target_os = "macos"';
  process.stdout.write(
    `#[cfg(any(${target}, test))]\n` +
      `const ${name}: [&[Permission]; 2] = [${requirements.join(", ")}];\n`,
  );
}

const { repair: table, rows }: { repair: number[]; rows: number[] } =
  JSON.parse(
    readFileSync(
      new URL(
        "../../settings/permissions/permission-policy.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
const actions = ["None", "Request", "OpenSettings", "CopyInput"];
if (table.length !== 32 || table.some((index) => !actions[index]))
  throw Error("Invalid Bend permission repair table");
process.stdout.write(
  `const REPAIR: [Repair; 32] = [${table.map((index) => "Repair::" + actions[index]).join(", ")}];\n`,
);

if (
  rows.length !== 3 ||
  rows.some((mask) => !Number.isInteger(mask) || mask < 0 || mask > 31)
)
  throw Error("Invalid Bend permission rows");
process.stdout.write(`const ROWS: [u32; 3] = [${rows.join(", ")}];\n`);
