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
    import updates from "./linux-updates.mjs";
    import confirmation from "./record-confirmation.mjs";
    for (const phase of ["idle", "completed", "starting", "recording", "processing", "selecting", ""]) {
      assert.equal(confirmation.capture_occupied(false, phase), false);
      assert.equal(confirmation.capture_occupied(true, phase), phase !== "idle" && phase !== "completed");
    }
    assert.equal(confirmation.may_confirm("confirm", "checked"), true);
    for (const [phase, availability] of [["confirm", "pending"], ["confirm", ""], ["starting", "checked"], ["error", "checked"]])
      assert.equal(confirmation.may_confirm(phase, availability), false);
    const list = items => items.reduceRight((tail, head) => ({ $: "Con", head, tail }), { $: "Nil" });
    const release = (index, tag, version, arch, prerelease = false, date = "2026-11-01") => {
      const name = "Apparent-" + version + "-linux-" + arch + ".AppImage";
      return {
        $: "Release", index, tag, draft: false, prerelease, published: { $: "Some", value: date },
        assets: list([{ $: "Asset", index: 0, name }, { $: "Asset", index: 1, name: name + ".sha256" }]),
      };
    };
    const tag = byte => "linux-main-v2-" + byte.repeat(40);
    const history = list([
      release(0, "v2.9.0", "2.9.0", "x86_64"),
      release(1, "v2.10.0", "2.10.0", "x86_64"),
      release(2, "v3.0.0", "3.0.0", "aarch64"),
      release(3, "v4294967296.0.0", "4294967296.0.0", "x86_64"),
      release(4, tag("a"), "2.10.0", "aarch64", true, "2026-11-03"),
      release(5, tag("b"), "3.0.0", "aarch64", true, "2026-11-02"),
      release(6, tag("g"), "2.10.0", "aarch64", true, "2026-11-04"),
    ]);
    assert.deepEqual(updates.select_release("stable", "x86_64", history).value,
      { $: "Selection", release: 1, image: 0, checksum: 1 });
    assert.equal(updates.select_release("stable", "aarch64", history).value.release, 2);
    assert.equal(updates.select_release("main", "aarch64", history).value.release, 4);
    assert.equal(updates.select_release("main", "x86_64", history).$, "None");
    assert.equal(updates.needs_channel_release("stable", "v2.10.0", true, "main", "v2.10.0", "", false), true);
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
      for (const checking of [false, true]) {
          const restart = actions.show_restart(pending, checking);
          assert.equal(restart, pending && !checking);
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
