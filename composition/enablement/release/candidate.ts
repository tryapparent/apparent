import type { Run, Job, Artifact } from "./github.ts";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { api, download, pages } from "./github.ts";
import type { Channel, Manifest } from "./manifest.ts";
import {
  candidateIdentity,
  digest,
  macFallbackJob,
  macPrimaryJob,
  repository,
  sha,
  targets,
  verify,
  workflow,
} from "./manifest.ts";

export function producer(
  run: Run,
  jobs: Job[],
  runId: string,
  attempt: number,
  channel: Channel = "stable",
  pairedMain = false,
): void {
  if (
    String(run.id) !== runId ||
    run.repository?.full_name !== repository ||
    run.head_repository?.full_name !== repository ||
    run.path !== workflow ||
    run.head_branch !== "main" ||
    !["workflow_dispatch", "workflow_run"].includes(run.event) ||
    !sha.test(run.head_sha) ||
    run.run_attempt < attempt
  )
    throw Error("Untrusted candidate producer");
  for (const { job: name } of targets(channel, pairedMain)) {
    const matching = jobs.filter(
      (job) =>
        (job.name === name ||
          (name === macPrimaryJob && job.name === macFallbackJob)) &&
        job.run_attempt === attempt,
    );
    if (
      new Set(matching.map((job) => job.name)).size !== matching.length ||
      matching.filter(
        (job) => job.conclusion === "success" && job.status === "completed",
      ).length !== 1
    )
      throw Error(`Producer job not successful: ${name}`);
  }
}
export async function restore(
  runId: string,
  attempt: number,
  directory: string,
  channel: Channel = "stable",
  pairedMain = false,
): Promise<Manifest[]> {
  if (!/^\d+$/.test(runId) || !Number.isSafeInteger(attempt) || attempt < 1)
    throw Error("Exact producer run/attempt required");
  const run = api<Run>(`actions/runs/${runId}`);
  producer(
    run,
    pages<Job>(`actions/runs/${runId}/attempts/${attempt}/jobs`, "jobs"),
    runId,
    attempt,
    channel,
    pairedMain,
  );
  const artifacts = pages<Artifact>(
    `actions/runs/${runId}/artifacts`,
    "artifacts",
  );
  const manifests: Manifest[] = [];
  mkdirSync(directory, { recursive: true });
  for (const { platform, architecture } of targets(channel, pairedMain)) {
    const name = `stable-${platform}-${architecture}-${attempt}`;
    const matches = artifacts.filter((a) => a.name === name);
    if (
      matches.length !== 1 ||
      matches[0].expired ||
      !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest) ||
      matches[0].workflow_run?.id !== Number(runId) ||
      matches[0].workflow_run?.head_sha !== run.head_sha
    )
      throw Error("Missing or untrusted immutable candidate artifact");
    const artifact = matches[0];
    const archive = join(directory, `${name}.zip`);
    download(`actions/artifacts/${artifact.id}/zip`, archive);
    if (`sha256:${await digest(archive)}` !== artifact.digest)
      throw Error("Artifact archive digest mismatch");
    const entries = execFileSync("unzip", ["-Z1", archive], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    if (
      !entries.length ||
      entries.some((entry) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry)) ||
      new Set(entries).size !== entries.length
    )
      throw Error("Unsafe candidate archive");
    const destination = join(directory, name);
    mkdirSync(destination);
    execFileSync("unzip", ["-q", archive, "-d", destination]);
    rmSync(archive);
    const manifest: Manifest = JSON.parse(
      readFileSync(
        join(destination, `manifest-${platform}-${architecture}.json`),
        "utf8",
      ),
    );
    if (
      manifest.platform !== platform ||
      manifest.architecture !== architecture ||
      manifest.producer.runId !== runId ||
      manifest.producer.runAttempt !== attempt ||
      manifest.producer.controlSha !== run.head_sha
    )
      throw Error("Artifact producer mismatch");
    await verify(destination, manifest);
    if (entries.length !== manifest.files.length + 1)
      throw Error("Unmanifested candidate files");
    manifests.push(manifest);
  }
  candidateIdentity(manifests, channel, pairedMain);
  return manifests;
}
