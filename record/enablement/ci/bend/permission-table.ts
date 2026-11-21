import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
} from "../../../../shared/enablement/bend/build.ts";
import { run } from "../../../../shared/enablement/bend/toolchain.ts";

export type PermissionTable = {
  repair: number[];
  rows: number[];
  screenSelection: number[];
  savePicker: boolean[];
};

export function repairTable(directory: string): PermissionTable {
  return JSON.parse(
    run(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
    import policy from "./permission-policy.mjs";
    const statuses = ["undetermined", "denied", "granted", "unavailable"];
    console.log(JSON.stringify({
      repair: Array.from({ length: 32 }, (_, index) =>
        policy.permission_repair(
          { $: statuses[index & 3] }, Boolean(index & 4), Boolean(index & 8), Boolean(index & 16)
        )
      ),
      rows: ["macos", "wayland", "x11"].map(($) => policy.settings_rows({ $ })),
      screenSelection: [false, true].flatMap(supported =>
        ["unset", "picker", "full_display"].map($ => policy.screen_selection(supported, { $ }))
      ),
      savePicker: [false, true].map(skip => policy.save_picker(skip))
    }));
  `,
      ],
      directory,
    ),
  );
}

if (import.meta.main) {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  await bendScratch(async (scratch) => {
    await buildBend(
      root,
      "record",
      scratch,
      undefined,
      "record/settings/permissions/",
    );
    console.log(JSON.stringify(repairTable(scratch)));
  });
}
