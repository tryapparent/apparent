import { readFileSync } from "node:fs";
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
};

export function repairTable(directory: string): PermissionTable {
  const table: PermissionTable = JSON.parse(
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
        [false, true].flatMap(directNeedsOptIn =>
          ["unset", "picker", "full_display"].map($ =>
            policy.screen_selection(supported, directNeedsOptIn, { $ })
          )
        )
      )
    }));
  `,
      ],
      directory,
    ),
  );
  const catalog = JSON.parse(
    readFileSync(
      new URL("../../../settings/preferences.json", import.meta.url),
      "utf8",
    ),
  ) as Array<{ id: string; default: unknown }>;
  const picker = catalog.find(
    ({ id }) => id === "permissions.skipScreenSelection",
  );
  if (picker?.default !== (table.screenSelection[6] === 2)) {
    throw Error(
      "Settings catalog must follow the Bend screen-selection default",
    );
  }
  return table;
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
