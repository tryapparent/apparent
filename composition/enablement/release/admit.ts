import type { Run, Job, Release } from "./github.ts";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { admitsCD } from "../../../shared/enablement/ci/release-admission.ts";
import { api, optional, pages } from "./github.ts";
import { releaseTag, repository, sha } from "./manifest.ts";
import { compareVersions, cargoVersion } from "./version.ts";

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim();
export async function admit(request = ""): Promise<void> {
  const channel = process.env.RELEASE_CHANNEL || "stable";
  const verificationRun = process.env.VERIFY_RUN_ID;
  if (channel !== "stable" && (channel !== "main" || !request))
    throw Error("Main release requires an exact source SHA");
  if (verificationRun && (!request || !/^[1-9]\d*$/.test(verificationRun)))
    throw Error("Invalid verification run ID");
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REF !== "refs/heads/main"
  )
    throw Error("Release must run on canonical main");
  const stable =
    channel === "stable"
      ? pages<Release>("releases")
          .filter(
            (r) =>
              !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name),
          )
          .sort((a, b) =>
            compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)),
          )[0]
      : undefined;
  let candidates: string[];
  if (request) {
    if (!sha.test(request)) throw Error("Exact source SHA required");
    candidates = [request];
  } else {
    candidates = [
      ...new Set(
        pages<Run>(
          "actions/workflows/checks.yml/runs?branch=main&event=push",
          "workflow_runs",
        ).map((r) => r.head_sha),
      ),
    ];
    candidates.sort(
      (a, b) =>
        Number(git("rev-list", "--count", b)) -
        Number(git("rev-list", "--count", a)),
    );
  }
  for (const candidate of candidates) {
    if (!sha.test(candidate)) throw Error("Invalid producer source SHA");
    try {
      git("merge-base", "--is-ancestor", candidate, "origin/main");
    } catch {
      continue;
    }
    const version = cargoVersion(candidate);
    if (stable && compareVersions(version, stable.tag_name.slice(1)) <= 0) {
      if (request) throw Error("Stable requires a new numeric version");
      continue;
    }
    const tag = releaseTag(channel, version, candidate);
    if (
      channel === "main" &&
      optional<Release>(`releases/tags/${tag}`)?.draft === false
    )
      throw Error(
        "This Main source already has immutable published assets; use the original run or choose another verified source",
      );
    const runs = verificationRun
      ? [api<Run>(`actions/runs/${verificationRun}`)]
      : pages<Run>(
          `actions/workflows/checks.yml/runs?head_sha=${candidate}&branch=main&event=push`,
          "workflow_runs",
        );
    let accepted = false;
    for (const run of runs) {
      if (verificationRun && String(run.id) !== verificationRun)
        throw Error("Verification run identity mismatch");
      const jobs = pages<Job>(
        `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
        "jobs",
      );
      if (admitsCD(run, jobs, repository, candidate, "linux")) {
        accepted = true;
        break;
      }
    }
    if (!accepted) {
      if (request) throw Error("No exact-source Linux/shared receipt");
      continue;
    }
    appendFileSync(
      process.env.GITHUB_OUTPUT!,
      `sha=${candidate}\nversion=${version}\ntag=${tag}\nproducer_attempt=${process.env.GITHUB_RUN_ATTEMPT}\n`,
    );
    console.log(
      `${channel} candidate ${candidate}, version ${version}; control ${process.env.GITHUB_WORKFLOW_SHA}`,
    );
    return;
  }
  if (request) throw Error("Requested release candidate not admitted");
  console.log(
    "No new eligible stable candidate; pending relevant changes remain measured from the last public stable source",
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await admit(process.argv[2]);
