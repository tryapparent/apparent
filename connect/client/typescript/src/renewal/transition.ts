import policy from "./credential-renewal.mjs";

type Facts =
  | { phase: "request"; refreshExpired: boolean; accessSeconds: number }
  | {
      phase: "locked";
      changed: boolean;
      force: boolean;
      accessSeconds: number;
      hasRefresh: boolean;
    }
  | { phase: "journal"; completed: boolean; refreshExpired: boolean }
  | { phase: "transport"; rejected: boolean; canRetry: boolean };

export function renewalTransition(input: string): string {
  const facts = JSON.parse(input) as Facts;
  switch (facts.phase) {
    case "request":
      return policy.before_request(facts.refreshExpired, facts.accessSeconds);
    case "locked":
      return policy.under_renewal_lock(
        facts.changed,
        facts.force,
        facts.accessSeconds,
        facts.hasRefresh,
      );
    case "journal":
      return policy.resume_renewal(facts.completed, facts.refreshExpired);
    case "transport":
      return policy.after_transport(facts.rejected, facts.canRetry);
    default:
      throw new Error("Invalid Connect renewal phase");
  }
}
