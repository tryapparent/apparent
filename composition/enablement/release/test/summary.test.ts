import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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

test("a superseded source is distinct from an unsuccessful freshness check", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "apparent-dev-summary-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd: directory, encoding: "utf8" },
    ).trim();
  git("init", "-q");
  writeFileSync(join(directory, "main.rs"), "fn main() {}\n");
  git("add", "main.rs");
  git("commit", "-qm", "source");
  const previous = git("rev-parse", "HEAD");
  writeFileSync(join(directory, "main.rs"), 'fn main() { println!("new"); }\n');
  git("commit", "-qam", "installer input change");
  const latest = git("rev-parse", "HEAD");
  const output = join(directory, "outputs");
  writeFileSync(output, "");
  git("update-ref", "refs/remotes/origin/main", latest);
  const check = (candidate: string, ...options: string[]) =>
    spawnSync(
      process.execPath,
      [
        "--experimental-strip-types",
        fileURLToPath(
          new URL(
            "../../../../enablement/ci/routing/streams.ts",
            import.meta.url,
          ),
        ),
        "capture",
        candidate,
        ...options,
      ],
      { cwd: directory, env: { ...process.env, GITHUB_OUTPUT: output } },
    );
  const report = "--report-superseded";
  assert.equal(check(latest, report).status, 0);
  assert.equal(readFileSync(output, "utf8"), "");
  assert.notEqual(check("invalid", report).status, 0);
  assert.notEqual(check(source, report).status, 0);
  assert.equal(check(previous).status, 1);
  assert.equal(readFileSync(output, "utf8"), "");
  assert.equal(check(previous, report).status, 0);
  assert.equal(readFileSync(output, "utf8"), `superseded_by=${latest}\n`);

  const jobs = pending();
  jobs.admit = job("success", { superseded_by: latest });
  const env = { REQUESTED_SOURCE: previous, RELEASE_CHANNEL: "main" };
  const superseded = await releaseSummary(jobs, env, noNetwork);
  assert.match(superseded, /Superseded/);
  assert.ok(superseded.includes(previous) && superseded.includes(latest));
  jobs.admit.result = "failure";
  const failed = await releaseSummary(jobs, env, noNetwork);
  assert.match(failed, /Failed.*[\s\S]*Inspect the admit job/);
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
