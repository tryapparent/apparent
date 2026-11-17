import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const endpoint = "https://eu.i.posthog.com/i/v0/e/";
const destination = "PostHog Error Tracking";

type Report = { kind: "feedback" | "bug"; title: string; body: string };
type Request = Report & {
  submit: boolean;
  token: string | null;
  build: string;
  environment: string;
};

function event(report: Request, id: string) {
  const issueName =
    report.kind === "bug" ? "Apparent CLI bug report" : "Apparent CLI feedback";
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([report.kind, report.title, report.body]))
    .digest("hex");
  return {
    api_key: report.token,
    event: "$exception",
    uuid: id,
    distinct_id: id,
    properties: {
      $process_person_profile: false,
      $geoip_disable: true,
      $ip: null,
      $lib: "apparent-cli",
      component: "agent-cli",
      source: "agent_cli_feedback",
      feedback_kind: report.kind,
      feedback_title: report.title,
      feedback_body: report.body,
      build: report.build,
      environment: report.environment,
      $os: process.platform,
      $issue_name: issueName,
      $exception_level: "error",
      $exception_fingerprint: `agent-cli:${report.kind}:${fingerprint}`,
      $exception_list: [
        {
          type:
            report.kind === "bug" ? "AgentCliBugReport" : "AgentCliFeedback",
          value: "See feedback_title and feedback_body on the exception event.",
          mechanism: { type: "generic", handled: true, synthetic: true },
        },
      ],
    },
  };
}

export async function reportFeedback(report: Request, send = fetch) {
  const { kind, title, body } = report;
  if (!title.trim() || [...title].length > 160 || /\p{Cc}/u.test(title)) {
    return {
      error:
        "Title must be 1–160 characters with no control characters. Nothing sent.",
    };
  }
  if (!body.trim() || Buffer.byteLength(body) > 8192 || body.includes("\0")) {
    return {
      error:
        "Body must be nonempty text of at most 8192 UTF-8 bytes without NUL. Nothing sent.",
    };
  }
  if (!report.submit)
    return { destination, kind, title, body, submitted: false };
  if (!report.token || !/^phc_[a-zA-Z0-9_-]{16,196}$/.test(report.token)) {
    return {
      error: "This build is not configured for PostHog feedback. Nothing sent.",
    };
  }

  const id = randomUUID();
  try {
    const response = await send(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event(report, id)),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        error: `PostHog returned HTTP ${response.status} for report ${id}.`,
      };
    }
    const receipt = await response.json();
    if (
      response.status === 200 &&
      (receipt.status === "Ok" || receipt.status === 1) &&
      (receipt.quota_limited === undefined ||
        (Array.isArray(receipt.quota_limited) && !receipt.quota_limited.length))
    ) {
      return { destination, kind, submitted: true, report_id: id };
    }
  } catch {
    return { error: `Could not confirm delivery to PostHog for report ${id}.` };
  }
  return { error: `Could not confirm delivery to PostHog for report ${id}.` };
}

async function main() {
  const input: Request = JSON.parse(readFileSync(0, "utf8"));
  return reportFeedback(input);
}

export { main };
