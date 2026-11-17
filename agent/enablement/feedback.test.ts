import assert from "node:assert/strict";
import { test } from "node:test";
import { reportFeedback } from "../feedback/report.ts";

const report = {
  kind: "bug" as const,
  title: "Zoom rejects 1:05",
  body: "Expected a time of 65 seconds.\nObserved an error.",
  submit: true,
  token: "phc_synthetic_feedback_fixture",
  build: "synthetic-build",
  environment: "synthetic",
};

test("preview and invalid or unconfigured submissions never contact PostHog", async () => {
  const send = () => assert.fail("unexpected network request");
  assert.deepEqual(
    await reportFeedback({ ...report, submit: false, token: null }, send),
    {
      destination: "PostHog Error Tracking",
      kind: "bug",
      title: report.title,
      body: report.body,
      submitted: false,
    },
  );
  for (const input of [
    { ...report, title: "  " },
    { ...report, title: "two\nlines" },
    { ...report, title: "a".repeat(161) },
    { ...report, body: "€".repeat(2731) },
    { ...report, body: "NUL\0" },
    { ...report, token: null },
  ]) {
    assert.match(
      (await reportFeedback(input, send)).error ?? "",
      /Nothing sent/,
    );
  }
});

test("PostHog receives labeled, anonymous exception events and a stable fingerprint per report", async () => {
  const events: {
    event: string;
    api_key: string;
    uuid: string;
    distinct_id: string;
    properties: Record<string, unknown> & {
      $exception_list: [{ type: string }];
    };
  }[] = [];
  const send: typeof fetch = async (url, options) => {
    assert.equal(url, "https://eu.i.posthog.com/i/v0/e/");
    assert.equal(options?.redirect, "error");
    assert.equal(options?.method, "POST");
    events.push(JSON.parse(String(options?.body)));
    return Response.json({ status: "Ok" });
  };
  const result = await reportFeedback(report, send);
  await reportFeedback(report, send);
  await reportFeedback({ ...report, body: "A different reproduction." }, send);
  await reportFeedback({ ...report, kind: "feedback" }, send);
  const [first, duplicate, different, feedback] = events;
  assert.deepEqual(result, {
    destination: "PostHog Error Tracking",
    kind: "bug",
    submitted: true,
    report_id: first.uuid,
  });
  assert.equal(first.event, "$exception");
  assert.equal(first.api_key, report.token);
  assert.equal(first.distinct_id, first.uuid);
  assert.notEqual(first.distinct_id, duplicate.distinct_id);
  const properties = first.properties;
  assert.equal(properties.$issue_name, "Apparent CLI bug report");
  assert.equal(properties.$exception_list[0].type, "AgentCliBugReport");
  assert.equal(properties.$exception_level, "error");
  assert.equal(properties.source, "agent_cli_feedback");
  assert.equal(properties.feedback_kind, "bug");
  assert.equal(properties.feedback_title, report.title);
  assert.equal(properties.feedback_body, report.body);
  assert.equal(properties.$process_person_profile, false);
  assert.equal(properties.$geoip_disable, true);
  assert.equal(properties.$ip, null);
  assert.equal(
    properties.$exception_fingerprint,
    duplicate.properties.$exception_fingerprint,
  );
  assert.notEqual(
    properties.$exception_fingerprint,
    different.properties.$exception_fingerprint,
  );
  assert.notEqual(
    properties.$exception_fingerprint,
    feedback.properties.$exception_fingerprint,
  );
  assert.equal(feedback.properties.$issue_name, "Apparent CLI feedback");
  assert.equal(feedback.properties.feedback_kind, "feedback");
});

test("failed or ambiguous ingestion does not return a success receipt or echo the response", async () => {
  for (const response of [
    new Response("private upstream error", { status: 429 }),
    new Response(null, { status: 204 }),
    new Response("private upstream error"),
    Response.json({ status: "Ok", quota_limited: ["exceptions"] }),
  ]) {
    let calls = 0;
    const result = await reportFeedback(report, async () => {
      calls++;
      return response;
    });
    assert.equal(calls, 1);
    assert.match(result.error ?? "", /PostHog.*report [a-f0-9-]{36}/);
    assert.doesNotMatch(result.error ?? "", /private upstream error/);
  }
});
