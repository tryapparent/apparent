import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { repository, sha, versionPattern } from "../manifest.ts";

type Job = { result: string; outputs: Record<string, string> };
type Jobs = Record<
  "admit" | "linux" | "macos" | "publish" | "feed" | "cask",
  Job
>;
type Download = { name: string; size: number };

const releaseUrl = `https://github.com/${repository}/releases/download`;

async function verifyLinks(
  tag: string,
  downloads: Download[],
  request: typeof fetch,
) {
  if (!Array.isArray(downloads) || !downloads.length)
    throw Error("Missing verified installer metadata");
  return Promise.all(
    downloads.map(async ({ name, size }) => {
      if (
        !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(AppImage|dmg|zip)$/.test(name) ||
        !Number.isSafeInteger(size) ||
        size < 1
      )
        throw Error("Invalid installer metadata");
      const url = `${releaseUrl}/${tag}/${name}`;
      const response = await request(url, {
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(15_000),
      });
      await response.body?.cancel();
      if (
        response.status !== 206 ||
        response.headers.get("content-range") !== `bytes 0-0/${size}`
      )
        throw Error(`Public download check failed for ${name}`);
      return `- [${name}](${url})`;
    }),
  );
}

export async function releaseSummary(
  jobs: Jobs,
  env: NodeJS.ProcessEnv,
  request = fetch,
): Promise<string> {
  const { admit, linux, macos, publish, feed, cask } = jobs;
  const channel = env.RELEASE_CHANNEL;
  const source = [
    publish.outputs.sha,
    admit.outputs.sha,
    env.REQUESTED_SOURCE,
  ].find((value) => value && sha.test(value));
  const run = env.PRODUCER_RUN ?? "";
  const attempt = env.PRODUCER_ATTEMPT ?? "";
  const producer =
    /^\d+$/.test(run) && /^\d+$/.test(attempt)
      ? `\nProducer [run ${run}, attempt ${attempt}](https://github.com/${repository}/actions/runs/${run}/attempts/${attempt})\n`
      : "";
  const report = (status: string, detail: string) =>
    `## Desktop release — ${status}\n\nSource SHA: ${source ? `\`${source}\`` : "Unavailable"}\n${producer}\n${detail}\n`;

  if (admit.result === "success" && sha.test(admit.outputs.superseded_by ?? ""))
    return report(
      "Superseded",
      `A newer Linux Main candidate was queued at \`${admit.outputs.superseded_by}\`.`,
    );

  const supersededTag = publish.outputs.superseded_tag ?? "";
  if (
    publish.result === "failure" &&
    /^(linux-main-v2-[a-f0-9]{40}|v\d+\.\d+\.\d+)$/.test(supersededTag)
  )
    return report(
      "Superseded",
      `Release \`${supersededTag}\` is already public. Use the newer release or build a newer verified source.`,
    );

  if (publish.result === "success") {
    const { tag, downloads } = publish.outputs;
    const validTag =
      channel === "stable"
        ? tag?.startsWith("v") && versionPattern.test(tag.slice(1))
        : tag ===
          `${channel === "mac-main" ? "mac" : "linux"}-main-v2-${source}`;
    try {
      if (publish.outputs.sha !== source || !source || !validTag)
        throw Error("Missing verified publication identity");
      const links = await verifyLinks(tag, JSON.parse(downloads), request);
      const distribution =
        channel === "stable" &&
        (feed.result !== "success" || cask.result !== "success")
          ? `\n\nStable distribution needs attention (feed: ${feed.result}, cask: ${cask.result}). Inspect those jobs and retry distribution for the exact producer attempt.`
          : "";
      return report("Published", links.join("\n") + distribution);
    } catch (error) {
      console.warn("Public installer link check failed:", error);
      return report(
        "Failed download verification",
        "Publication completed. Check anonymous access to the installer assets and verify their sizes against the producer manifests before distributing links.",
      );
    }
  }

  if (
    admit.result === "success" &&
    !source &&
    !env.REQUESTED_SOURCE &&
    channel === "stable" &&
    publish.result === "skipped"
  )
    return report(
      "No eligible stable candidate",
      "Use a verified main source with a Cargo version newer than the current stable release.",
    );
  if (admit.result !== "success" && admit.result !== "skipped")
    return report(
      "Failed",
      "Inspect admission for a newer queued source, exact-source verification, or signing configuration.",
    );
  const producers = [
    ["Linux", linux],
    ["macOS", macos],
  ] as const;
  const abandoned = producers.filter(([, job]) => job.result === "abandoned");
  if (abandoned.length)
    return report(
      "Failed",
      `GitHub Actions could not allocate a runner for ${abandoned.map(([name]) => name).join(" and ")}. Review the producer jobs and retry the release once runner capacity returns.`,
    );
  const failed = producers.filter(
    ([, job]) => job.result !== "success" && job.result !== "skipped",
  );
  if (failed.length)
    return report(
      "Failed",
      `Inspect the ${failed.map(([name]) => name).join(" and ")} producer jobs for the failure or cancellation before retrying.`,
    );
  if (publish.result !== "skipped")
    return report(
      "Failed",
      publish.outputs.sha
        ? "Inspect the publish job for the source, tag, or asset check that failed. Retry with the same producer run and attempt once resolved."
        : "Inspect the publish job. Confirm the exact producer run and attempt have successful builds and intact, unexpired artifacts.",
    );
  return report(
    "Failed",
    "Publication was skipped. Check the release inputs and upstream job results. A publication-only retry requires the original producer run and attempt with an empty source input.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY!,
    await releaseSummary(JSON.parse(process.env.RELEASE_JOBS!), process.env),
  );
}
