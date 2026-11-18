import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { pages } from "../github.ts";
import type { Job } from "../github.ts";
import { macFallbackJob, macPrimaryJob } from "../manifest.ts";

export function alternateRunner(label: string): string {
  if (label === "macos-26") return "macos-15";
  if (label === "macos-15") return "macos-26";
  throw Error("Unsupported Mac release runner");
}

export function capacityCancelled(
  job: Job,
  label: string,
  annotations: { message: string }[],
): boolean {
  return (
    job.status === "completed" &&
    ["cancelled", "abandoned"].includes(job.conclusion ?? "") &&
    job.runner_id === 0 &&
    job.steps?.length === 0 &&
    job.labels?.length === 1 &&
    job.labels[0] === label &&
    annotations.some(({ message }) =>
      message.includes("The job was not acquired by Runner of type hosted"),
    )
  );
}

function attemptJobs(run: string, attempt: string): Job[] {
  if (!/^[1-9]\d*$/.test(run) || !/^[1-9]\d*$/.test(attempt))
    throw Error("Exact Mac release run and attempt required");
  return pages<Job>(
    `actions/runs/${run}/attempts/${attempt}/jobs`,
    "jobs",
  ).filter((job) => job.run_attempt === Number(attempt));
}

function selectFallback(jobs: Job[], label: string): void {
  const alternate = alternateRunner(label);
  const matches = jobs.filter((job) => job.name === macPrimaryJob);
  const job = matches[0];
  if (matches.length !== 1 || !Number.isSafeInteger(job.id))
    throw Error("Could not identify the primary Mac release job");
  const annotations = pages<{ message: string }>(
    `check-runs/${job.id}/annotations`,
  );
  if (!capacityCancelled(job, label, annotations))
    throw Error("Mac release failed outside hosted runner assignment");
  appendFileSync(process.env.GITHUB_OUTPUT!, `runner=${alternate}\n`);
  console.log(`GitHub could not assign ${label}; trying ${alternate} once`);
}

export function queueReport(jobs: Job[]): string {
  return jobs
    .flatMap((job) => {
      if (job.name !== macPrimaryJob && job.name !== macFallbackJob) return [];
      const label = job.labels?.[0];
      if (label !== "macos-26" && label !== "macos-15") return [];
      const setup = job.steps?.find(
        (step) => step.name === "Set up job",
      )?.started_at;
      const noRunner = job.runner_id === 0 && job.status === "completed";
      const end = setup ?? (noRunner ? job.completed_at : undefined);
      const seconds =
        (Date.parse(end ?? "") - Date.parse(job.created_at ?? "")) / 1000;
      if (!Number.isFinite(seconds) || seconds < 0) return [];
      return `- ${label}: ${seconds}s ${setup ? "to runner setup" : "before cancellation without a runner"}`;
    })
    .join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const jobs = attemptJobs(
    process.env.GITHUB_RUN_ID ?? "",
    process.env.GITHUB_RUN_ATTEMPT ?? "",
  );
  if (process.argv[2] === "report") {
    const report = queueReport(jobs);
    if (report)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY!,
        `## Mac runner assignment\n\n${report}\n`,
      );
  } else {
    selectFallback(jobs, process.env.MAC_RUNNER ?? "");
  }
}
