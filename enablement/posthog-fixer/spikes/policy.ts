export type SpikePolicy = {
  qualifies(users: number, occurrences: number, baseline: number): boolean;
  admits(hot: boolean, secondsSinceLaunch: number): boolean;
};

export type Spike = {
  issue: string;
  users: number;
  occurrences: number;
  baseline: number;
  observedAt: number;
};

export function activeIssue(status: unknown): boolean {
  if (status === "active") return true;
  if (
    ["resolved", "suppressed", "archived", "pending_release"].some(
      (value) => value === status,
    )
  )
    return false;
  throw Error("Invalid PostHog issue status");
}
