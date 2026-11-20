import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseSummary } from "../report/summary.ts";

const source = "1".repeat(40);
const newer = "2".repeat(40);
const job = (result = "skipped", outputs: Record<string, string> = {}) => ({
  result,
  outputs,
});
const pending = () => ({
  admit: job(),
  linux: job(),
  macos: job(),
  publish: job(),
  feed: job(),
  cask: job(),
});
const noNetwork: typeof fetch = async () =>
  assert.fail("No download should be attempted");

test("a published Linux Main release remains visible after Mac runner failure", async () => {
  const jobs = {
    ...pending(),
    admit: job("success", { sha: source }),
    linux: job("success"),
    macos: job("abandoned"),
    "publish-linux": job("success", {
      sha: source,
      tag: `linux-main-v2-${source}`,
      downloads: JSON.stringify([{ name: "Apparent-linux.AppImage", size: 5 }]),
    }),
    "publish-nightly": job(),
  };
  const result = await releaseSummary(
    jobs,
    { RELEASE_CHANNEL: "main" },
    async () =>
      new Response("a", {
        status: 206,
        headers: { "content-range": "bytes 0-0/5" },
      }),
  );
  assert.match(
    result,
    /Linux Main[\s\S]*Published[\s\S]*Apparent-linux\.AppImage/,
  );
  assert.match(
    result,
    /Mac Nightly[\s\S]*could not allocate a runner for macOS/,
  );
  assert.doesNotMatch(result, /Mac Nightly update discovery needs attention/);
});

test("a superseded source is distinct from an unsuccessful admission", async () => {
  const jobs = pending();
  jobs.admit = job("success", { superseded_by: newer });
  const env = { REQUESTED_SOURCE: source, RELEASE_CHANNEL: "main" };
  const superseded = await releaseSummary(jobs, env, noNetwork);
  assert.match(superseded, /Superseded/);
  assert.ok(superseded.includes(source) && superseded.includes(newer));
  jobs.admit.result = "failure";
  const failed = await releaseSummary(jobs, env, noNetwork);
  assert.match(failed, /Failed.*[\s\S]*Inspect admission/);
  assert.doesNotMatch(failed, /Superseded|releases\/download/);
});

test("producer failure, missing retry artifacts and a stable no-op give distinct instructions", async () => {
  const jobs = pending();
  jobs.admit = job("success", { sha: source });
  jobs.linux = job("failure");
  jobs.macos = job("cancelled");
  assert.match(
    await releaseSummary(jobs, {}, noNetwork),
    /Linux and macOS producer jobs/,
  );
  jobs.linux = job();
  jobs.macos = job();
  jobs.admit = job();
  jobs.publish = job("failure");
  const retry = await releaseSummary(
    jobs,
    {
      PRODUCER_RUN: "123",
      PRODUCER_ATTEMPT: "2",
      RELEASE_CHANNEL: "main",
    },
    noNetwork,
  );
  assert.match(
    retry,
    /Source SHA: Unavailable[\s\S]*runs\/123\/attempts\/2[\s\S]*unexpired artifacts/,
  );
  jobs.publish = job();
  jobs.admit = job("success");
  const stable = await releaseSummary(
    jobs,
    { RELEASE_CHANNEL: "stable" },
    noNetwork,
  );
  assert.match(stable, /No eligible stable candidate/);
  jobs.publish = job("failure", { sha: source, superseded_tag: "v1.3.0" });
  const superseded = await releaseSummary(
    jobs,
    { RELEASE_CHANNEL: "stable" },
    noNetwork,
  );
  assert.match(superseded, /Superseded[\s\S]*v1\.3\.0/);
  assert.doesNotMatch(superseded, /releases\/download/);
});

test("runner abandonment names the missing macOS runner and source", async () => {
  const jobs = pending();
  jobs.admit = job("success", { sha: source });
  jobs.linux = job("success");
  jobs.macos = job("abandoned");
  const report = await releaseSummary(
    jobs,
    { RELEASE_CHANNEL: "main" },
    noNetwork,
  );
  assert.match(report, /Failed/);
  assert.ok(report.includes(source));
  assert.match(report, /GitHub Actions could not allocate a runner for macOS/);
  assert.match(report, /retry the release once runner capacity returns/);
  assert.doesNotMatch(report, /releases\/download|publication-only retry/);
});

test("only successful publication with a publicly reachable asset produces download links", async () => {
  const jobs = pending();
  const tag = `linux-main-v2-${source}`;
  const name = "Apparent-1.2.3-linux-x86_64.AppImage";
  jobs.publish = job("success", {
    sha: source,
    tag,
    downloads: JSON.stringify([{ name, size: 5 }]),
  });
  const env = { RELEASE_CHANNEL: "main", REQUESTED_SOURCE: newer };
  const request: typeof fetch = async (url, init) => {
    assert.equal(
      url,
      `https://github.com/tryapparent/apparent/releases/download/${tag}/${name}`,
    );
    assert.deepEqual(init?.headers, { Range: "bytes=0-0" });
    return new Response("a", {
      status: 206,
      headers: { "content-range": "bytes 0-0/5" },
    });
  };
  const printed = await releaseSummary(jobs, env, request);
  assert.match(printed, /Published/);
  assert.ok(printed.includes(source) && !printed.includes(newer));
  assert.ok(printed.includes(`[${name}]`));
  jobs.publish.outputs.tag = "v1.2.3";
  jobs.feed = job("success");
  jobs.cask = job("failure");
  const distribution = await releaseSummary(
    jobs,
    { RELEASE_CHANNEL: "stable" },
    async () =>
      new Response("a", {
        status: 206,
        headers: { "content-range": "bytes 0-0/5" },
      }),
  );
  assert.match(distribution, /Published[\s\S]*feed: success, cask: failure/);
  jobs.publish.outputs.tag = tag;

  for (const response of [
    new Response(null, { status: 404 }),
    new Response("a", {
      status: 206,
      headers: { "content-range": "bytes 0-0/4" },
    }),
  ]) {
    const unavailable = await releaseSummary(jobs, env, async () => response);
    assert.match(unavailable, /Failed download verification/);
    assert.doesNotMatch(unavailable, /releases\/download/);
  }
  jobs.publish.result = "failure";
  const failed = await releaseSummary(jobs, env, noNetwork);
  assert.match(failed, /source, tag, or asset check/);
  assert.doesNotMatch(failed, /releases\/download/);
});
