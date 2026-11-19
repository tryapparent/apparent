import assert from "node:assert/strict";
import { test } from "node:test";
import { comments } from "../comments.ts";

test("Objective-C Node-API registration preserves comment checks", async () => {
  const source = "// existing\nNAPI_MODULE(apparent_pill_window, initialize)\n";
  assert.deepEqual(await comments("pill.m", source), ["// existing"]);
  await assert.rejects(
    comments("pill.m", source + "int broken = ;\n"),
    /syntax parser/,
  );
  await assert.rejects(
    comments("pill.m", source.replace("NAPI_MODULE", "other")),
    /syntax parser/,
  );
});
