import assert from "node:assert/strict";
import { test } from "node:test";
import { commands } from "../run.ts";

test("Engine and Connect client verification prepares the locked TypeScript package before client Cargo", () => {
  for (const platform of ["linux", "darwin"] as const) {
    const plan = commands(["engine", "client"], "base", "head", platform);
    const prepare = plan.findIndex(({ argv }) =>
      argv.includes("--prepare-connect-typescript"),
    );
    const clientCargo = plan.findIndex(({ argv }) =>
      argv.includes("connect/client/Cargo.toml"),
    );
    assert.ok(prepare >= 0 && prepare < clientCargo, platform);
  }
});
