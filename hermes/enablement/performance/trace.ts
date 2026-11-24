import assert from "node:assert/strict";
import type { Phase, Resources } from "./score.ts";

const milliseconds = (nanos: number) => nanos / 1e6;

type Span = {
  name: string;
  parent: number | null;
  startNs: number;
  endNs: number;
};
type Attempt = {
  phase: Phase;
  dispatchStartNs: number;
  deliveredNs: number;
  workerEntryNs?: number;
  probeReadyNs?: number;
  spans: Span[];
  verification: {
    transcriptVerified: boolean;
    interactionVerified: boolean;
    pixelsVerified: boolean;
    resultSha256: string;
    imageBytes: number;
  };
  resources: Resources;
};
export type Probe = {
  pythonVersion: string;
  pillowVersion: string;
  attempts: Attempt[];
  totalCpuMs: number;
};

export function traceReceipt(
  attempt: Attempt,
  attemptId: string,
  launchNs: number,
  receivedNs: number,
) {
  const cold = attempt.phase === "cold";
  const startNs = cold ? launchNs : attempt.dispatchStartNs;
  const endNs = attempt.deliveredNs;
  assert(
    launchNs <= startNs && startNs < endNs && endNs <= receivedNs,
    "Observer and Python clock ordering failed",
  );
  const spans = [...attempt.spans];
  if (cold && spans.length) {
    assert(attempt.workerEntryNs && attempt.probeReadyNs);
    spans.push(
      {
        name: "Python worker launch",
        parent: null,
        startNs,
        endNs: attempt.workerEntryNs,
      },
      {
        name: "probe bootstrap",
        parent: null,
        startNs: attempt.workerEntryNs,
        endNs: attempt.probeReadyNs,
      },
    );
  }
  for (const [index, span] of spans.entries()) {
    const parent =
      span.parent === null ? { startNs, endNs } : spans[span.parent];
    assert(parent && (span.parent === null || span.parent < index));
    assert(
      parent.startNs <= span.startNs &&
        span.startNs <= span.endNs &&
        span.endNs <= parent.endNs,
      "Span escaped its enclosing interval",
    );
  }
  const criticalPath = spans.map((span, index) => {
    const children = spans.filter((candidate) => candidate.parent === index);
    const inclusive = span.endNs - span.startNs;
    const childTime = children.reduce(
      (total, child) => total + child.endNs - child.startNs,
      0,
    );
    return {
      span: index,
      name: span.name,
      inclusiveMs: milliseconds(inclusive),
      exclusiveMs: milliseconds(inclusive - childTime),
    };
  });
  const topLevel = spans
    .filter((span) => span.parent === null)
    .sort((a, b) => a.startNs - b.startNs);
  const unattributedNs =
    endNs -
    startNs -
    topLevel.reduce((total, span) => total + span.endNs - span.startNs, 0);
  assert(
    criticalPath.every((stage) => stage.exclusiveMs >= 0) &&
      unattributedNs >= 0,
  );
  const overlap = spans.flatMap((span, index) => {
    if (span.name !== "CLI summary" && span.name !== "CLI manifest") return [];
    const children = spans.filter((child) => child.parent === index);
    const launch = children.find((child) => child.name === "launch supervisor");
    const signal = children.find(
      (child) => child.name === "signal supervisor group",
    );
    if (!launch || !signal) return [];
    const liveFrom = launch.endNs;
    const liveUntil = signal.startNs;
    const waitNs = children
      .filter((child) => child.name === "await CLI pipe readiness")
      .reduce(
        (sum, child) =>
          sum +
          Math.max(
            0,
            Math.min(child.endNs, liveUntil) -
              Math.max(child.startNs, liveFrom),
          ),
        0,
      );
    return [
      {
        cliSpan: index,
        supervisorObservedFromNs: liveFrom,
        supervisorSignalNs: liveUntil,
        parentAwaitingOutputDuringSupervisorLifetimeMs: milliseconds(waitNs),
      },
    ];
  });
  return {
    attemptId,
    phase: attempt.phase,
    clock: "linux-host-monotonic",
    startNs,
    endNs,
    observedAfterVerificationNs: receivedNs,
    ms: milliseconds(endNs - startNs),
    spans,
    criticalPath,
    overlap,
    unattributedMs: milliseconds(unattributedNs),
    verification: attempt.verification,
    resources: attempt.resources,
  };
}
