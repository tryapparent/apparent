import { reportFeedback } from "../../agent/feedback/report.ts";
import { writtenReportHost } from "../../handoff/feedback/written-host.ts";
import type { WrittenResult } from "../../handoff/feedback/contract.ts";

export function settingsFeedbackHost(settings: {
  token: string | undefined;
  build: string | undefined;
  environment: string | undefined;
}) {
  const { token, build, environment } = settings;
  const available = Boolean(token && /^phc_[a-zA-Z0-9_-]{16,196}$/.test(token) && build && environment);
  const submit = writtenReportHost(async ({ description, id }): Promise<WrittenResult> => {
    if (!available || !token || !build || !environment) return "unavailable";
    const result = await reportFeedback({
      kind: "bug",
      title: "Written bug report",
      body: description,
      token,
      build,
      environment,
      desktop: { id },
      submit: true,
    });
    return "submitted" in result && result.submitted ? "sent" : "unconfirmed";
  });
  async function submitRecording(id: string, event: string): Promise<WrittenResult> {
    if (!available || !token || !build || !environment) return "unavailable";
    const result = await reportFeedback({
      kind: "bug",
      title: "Recorded bug report",
      body: id,
      token, build, environment,
      desktop: { id: event, supportReport: id },
      submit: true,
    });
    return "submitted" in result && result.submitted ? "sent" : "unconfirmed";
  }
  return { available, submit, submitRecording };
}
