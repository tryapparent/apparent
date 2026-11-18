import { recordingPermissions } from "../../capture-request/src/permission-requirements.ts";

for (const platform of ["macos", "linux"] as const) {
  const modes = recordingPermissions[platform];
  const name = platform.toUpperCase();
  const requirements = [modes.silent, modes.narrated].map(
    (permissions) =>
      `&[${permissions.map((permission) => `Permission::${permission}`).join(", ")}]`,
  );
  const target =
    platform === "macos" ? 'target_os = "macos"' : 'not(target_os = "macos")';
  process.stdout.write(
    `#[cfg(any(${target}, test))]\n` +
      `const ${name}: [&[Permission]; 2] = [${requirements.join(", ")}];\n`,
  );
}
