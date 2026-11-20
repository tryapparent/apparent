import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  bendScratch,
  buildBend,
  proofOptions,
} from "../../../../shared/enablement/bend/build.ts";

await bendScratch(async (destination) => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  await buildBend(
    root,
    "composition",
    destination,
    proofOptions(process.argv.slice(2)),
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import policy from "./mac-updates.mjs";
    import actions from "./release-action.mjs";
    for (const mac of [false, true])
      for (const nightly of [false, true])
        assert.equal(policy.show_nightly_download(mac, nightly), mac && !nightly);
    assert.equal(actions.release_action(true), "Install latest channel release");
    assert.equal(actions.release_action(false), "Check for updates");
  `,
    ],
    { cwd: destination, stdio: "inherit" },
  );
});
