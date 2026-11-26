import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  statSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.ok(process.argv[2], "Pass the Apparent CLI executable");
const binary = resolve(process.argv[2]);
const job = mkdtempSync(join(tmpdir(), "apparent-dev-trace-proof-"));
const config = join(job, "config.json");
const store = join(job, "workflow-traces");
const movie = join(job, "synthetic-private-source.mp4");
const review = join(job, "synthetic-private-review");
const invalidReview = join(job, "refused-private-review");

function cli(...args: string[]) {
  const run = spawnSync(binary, args, {
    env: { ...process.env, APPARENT_CONFIG: config },
    encoding: "utf8",
    timeout: 30000,
  });
  if (run.error) throw run.error;
  return run;
}

function successful(...args: string[]) {
  const result = cli(...args);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

try {
  assert.match(successful("trace", "--help"), /private timings/);
  assert.match(cli("trace", "start").stderr, /Enable CLI workflow tracing/);
  assert.equal(existsSync(store), false);
  successful("settings", "set", "labs.videoTracing", "true");
  const id = successful("trace", "start").trim();
  assert.match(id, /^trace-[A-Za-z0-9]{20}$/);
  assert.equal(statSync(store).mode & 0o777, 0o700);
  assert.equal(statSync(join(store, id, "trace.json")).mode & 0o777, 0o600);

  execFileSync("ffmpeg", [
    "-nostdin",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=320x240:d=2:r=12",
    "-c:v",
    "libx264",
    movie,
  ]);
  const invalid = cli(
    "--trace",
    "../wrong",
    "video",
    "inspect",
    movie,
    "--out",
    invalidReview,
  );
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid trace ID/);
  assert.equal(existsSync(invalidReview), false);
  const unsupported = cli(
    "--trace",
    id,
    "settings",
    "get",
    "labs.videoTracing",
  );
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.stderr, /does not support workflow tracing/);

  const result = successful(
    "--trace",
    id,
    "video",
    "inspect",
    movie,
    "--out",
    review,
    "--frames",
    "2",
  );
  assert.ok(existsSync(review));
  const missing = cli(
    "video",
    "inspect",
    join(job, "synthetic-missing.mp4"),
    "--out",
    invalidReview,
    "--trace",
    id,
  );
  assert.notEqual(missing.status, 0);
  successful("settings", "set", "labs.videoTracing", "false");
  const disabled = cli(
    "--trace",
    id,
    "video",
    "inspect",
    movie,
    "--out",
    invalidReview,
  );
  assert.notEqual(disabled.status, 0);
  assert.match(disabled.stderr, /Enable CLI workflow tracing/);
  successful("trace", "end", id);
  successful("settings", "set", "labs.videoTracing", "true");
  const ended = cli(
    "--trace",
    id,
    "video",
    "inspect",
    movie,
    "--out",
    invalidReview,
  );
  assert.notEqual(ended.status, 0);
  assert.match(ended.stderr, /Trace has ended/);

  const json = successful("trace", "report", id);
  const report = JSON.parse(json);
  assert.equal(report.schema, 1);
  assert.equal(report.trace_id, id);
  assert.ok(report.ended_ms >= report.started_ms);
  assert.deepEqual(
    report.attempts.map((entry: { command: string }) => entry.command),
    ["video inspect", "video inspect"],
  );
  assert.deepEqual(
    report.attempts.map(
      (entry: { result: { succeeded: boolean } }) => entry.result.succeeded,
    ),
    [true, false],
  );
  for (const { result: completion, build } of report.attempts) {
    assert.ok(
      Number.isSafeInteger(completion.elapsed_ms) && completion.elapsed_ms >= 0,
    );
    assert.ok(build.includes("·"));
  }
  for (const secret of [
    job,
    movie,
    review,
    "synthetic-private",
    "synthetic-missing",
  ])
    assert.ok(!json.includes(secret));
  assert.deepEqual(
    report,
    JSON.parse(readFileSync(join(store, id, "trace.json"), "utf8")),
  );
  console.log(successful("--version").trim());
  console.log("Video inspection stdout was preserved.");
  console.log(result.trim());
  console.log("Verified private workflow report.");
  console.log(json.trim());
} finally {
  rmSync(job, { recursive: true, force: true });
}
