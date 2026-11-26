import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export const desktopFrogTablePath = new URL(
  "../../../host/traversal/desktop-frog.json",
  import.meta.url,
);

export function desktopFrogTable(directory: string) {
  return run(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import policy from "./desktop-frog.mjs";
    const flags = [false, true];
    console.log(JSON.stringify({
      naming: flags.flatMap(active => flags.flatMap(named => flags.map(revealed => policy.naming_stage(active, named, revealed)))),
      name: [0, 1, 23, 24, 25].flatMap(length => flags.map(control => policy.accept_name(control, length))),
      visible: flags.flatMap(adopted => flags.map(unavailable => policy.desktop_visible(adopted, unavailable))),
      clamp: [0, 32, 128].flatMap(wanted => [10, 50, 100].map(extent => policy.clamp_offset(wanted, extent, 20))),
      pauseMs: policy.desktop_pause_ms()
    }));
  `,
    ],
    directory,
  );
}

if (import.meta.main) {
  const { naming, visible } = JSON.parse(
    readFileSync(desktopFrogTablePath, "utf8"),
  );
  assert.ok(
    naming.length === 8 &&
      naming.every((stage: number) => [0, 1, 2].includes(stage)),
  );
  assert.ok(
    visible.length === 4 &&
      visible.every((value: boolean) => typeof value === "boolean"),
  );
  process.stdout.write(
    `pub(super) const NAMING: [u8; 8] = [${naming.join(", ")}];\npub(in crate::capture::desktop) const VISIBLE: [bool; 4] = [${visible.join(", ")}];\n`,
  );
}
