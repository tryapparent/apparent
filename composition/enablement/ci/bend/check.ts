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
    assert.equal(actions.release_action(false), "Check for updates");
    assert.equal(actions.release_action(true), "Check again");
    assert.equal(actions.staged_release_note("stable", "v2.0.0"), "Restart to use Stable v2.0.0.");
    for (const id of ["", "v", "v.2.0", "v2.0.", "v2..0", "v2.0.0-dev", "v" + "1".repeat(100)])
      assert.equal(actions.staged_release_note("stable", id), "Restart to use the installed Stable release.");
    assert.equal(actions.staged_release_note("main", "a1b2c3DF" + "0".repeat(32)), "Restart to use Development build a1b2c3DF.");
    for (const id of ["", "a".repeat(39), "a".repeat(40) + "a", "a".repeat(39) + "g"])
      assert.equal(actions.staged_release_note("main", id), "Restart to use the installed Development build.");
    assert.equal(actions.staged_release_note("", "v2.0.0"), "Restart to use the installed update.");
    for (const pending of [false, true])
      for (const checking of [false, true])
        for (const offer of [false, true]) {
          const restart = actions.show_restart(pending, checking);
          assert.equal(restart, pending && !checking);
          assert.equal(actions.show_restart_later(restart, offer), pending && !checking && offer);
          assert.equal(actions.show_failure(true, true, restart), restart);
          assert.equal(actions.show_unstaged_restart_failure(true, restart), !restart);
          assert.equal(actions.show_unstaged_restart_failure(false, restart), false);
          assert.equal(actions.show_failure(true, false, restart), true);
          assert.equal(actions.show_failure(false, false, restart), false);
        }
  `,
    ],
    { cwd: destination, stdio: "inherit" },
  );
});
