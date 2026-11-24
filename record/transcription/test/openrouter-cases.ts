import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  filename,
  readCredential,
  settings,
  transcribe,
} from "../src/openrouter.ts";

const directory = mkdtempSync(
  join(process.env.RUNNER_TEMP ?? tmpdir(), "apparent-dev-openrouter-test-"),
);
try {
  const config = join(directory, "config.json");
  const model = "microsoft/mai-transcribe-2";
  const key = "sk-or-v1-synthetic-proof";
  assert.deepEqual(settings(config, { action: "read" }), {
    saved: false,
    enabled: false,
    model,
  });
  assert.deepEqual(settings(config, { action: "save", key }), {
    saved: true,
    enabled: false,
    model,
  });
  assert.equal(statSync(join(directory, filename)).mode & 0o777, 0o600);
  assert.deepEqual(
    await transcribe(
      readCredential(config),
      () => assert.fail("Disabled trial read audio"),
      1000,
    ),
    {},
  );
  assert.throws(() =>
    settings(config, { action: "choose", enabled: true, model: "arbitrary" }),
  );
  settings(config, { action: "choose", enabled: true, model });
  const credential = readCredential(config);
  const audio = Buffer.from("fixture");
  const outcome = await transcribe(
    credential,
    () => audio,
    1000,
    async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/audio/transcriptions");
      assert.equal(options?.redirect, "error");
      assert.equal(
        new Headers(options?.headers).get("authorization"),
        `Bearer ${key}`,
      );
      assert.deepEqual(JSON.parse(String(options?.body)), {
        model,
        input_audio: { format: "wav", data: audio.toString("base64") },
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
      });
      return Response.json({
        text: "Synthetic word",
        usage: { seconds: 1.25, cost: 0.00004 },
        words: [{ word: "Synthetic", start: 0.2, end: 0.8 }],
        segments: [{ text: "Synthetic word", start: 0, end: 1 }],
      });
    },
  );
  assert.equal(outcome.trace?.outcome, "success");
  assert.equal(outcome.trace.httpStatus, 200);
  assert.equal(outcome.trace.providerAudioSeconds, 1.25);
  assert.equal(outcome.trace.costUsd, 0.00004);
  assert.equal(outcome.trace.audioBytes, audio.length);
  assert.ok(Number.isInteger(outcome.trace.requestMs));
  assert.deepEqual(outcome.transcript?.words, [
    { t0: 200, t1: 800, text: "Synthetic" },
  ]);
  const denied = await transcribe(
    credential,
    () => audio,
    1000,
    async () =>
      Response.json(
        { error: { key, content: "Sensitive upstream error" } },
        { status: 401 },
      ),
  );
  assert.equal(denied.trace?.outcome, "http_error");
  assert.equal(denied.trace.httpStatus, 401);
  assert.equal(denied.transcript, undefined);
  assert.doesNotMatch(
    JSON.stringify(denied),
    /synthetic-proof|Sensitive upstream error/,
  );
  const malformed = await transcribe(
    credential,
    () => audio,
    1000,
    async () => Response.json({ text: "missing timings" }),
  );
  assert.equal(malformed.trace?.outcome, "invalid_response");
  settings(config, { action: "remove" });
  assert.equal(readCredential(config), undefined);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
