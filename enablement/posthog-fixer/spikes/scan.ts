import { pathToFileURL } from "node:url";
import type { Config } from "../config.ts";
import type { Store } from "../store.ts";
import { posthogRead } from "../worker.ts";
import { activeIssue, type Spike, type SpikePolicy } from "./policy.ts";

const hour = 3600000;
const interval = 15 * 60000;
const issueId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
type Read = (tool: string, args: object) => Promise<unknown>;
type Issue = {
  id: string;
  first_seen: string;
  status: string;
  aggregations: { users: number; occurrences: number };
};

function count(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw Error("Invalid PostHog count");
  return value;
}

export async function readSpikes(
  read: Read,
  now: number,
  policy: SpikePolicy,
): Promise<Spike[]> {
  const from = now - hour;
  const baseline = {
    date_from: new Date(from - 168 * hour).toISOString(),
    date_to: new Date(from).toISOString(),
  };
  const dateRange = {
    date_from: baseline.date_to,
    date_to: new Date(now).toISOString(),
  };
  const candidates: Omit<Spike, "baseline">[] = [];
  const seen = new Set<string>();
  const limit = 25;
  let complete = false;
  for (let offset = 0; offset < 250 && !complete; offset += limit) {
    const page = (await read("query-error-tracking-issues-list", {
      dateRange,
      status: "active",
      orderBy: "users",
      orderDirection: "DESC",
      filterTestAccounts: true,
      limit,
      offset,
    })) as { results: Issue[]; hasMore: boolean };
    if (
      !Array.isArray(page?.results) ||
      typeof page.hasMore !== "boolean" ||
      (page.hasMore && page.results.length !== limit)
    )
      throw Error("Invalid PostHog issue page");
    for (const issue of page.results) {
      if (
        !issueId.test(issue.id) ||
        seen.has(issue.id) ||
        issue.status !== "active"
      )
        throw Error("Invalid PostHog issue row");
      seen.add(issue.id);
      const users = count(issue.aggregations.users);
      const occurrences = count(issue.aggregations.occurrences);
      if (!policy.qualifies(users, occurrences, 0)) {
        complete = true;
        break;
      }
      const firstSeen = Date.parse(issue.first_seen);
      if (!Number.isFinite(firstSeen)) throw Error("Invalid PostHog issue age");
      if (firstSeen < from)
        candidates.push({
          issue: issue.id,
          users,
          occurrences,
          observedAt: now,
        });
    }
    complete ||= !page.hasMore;
  }
  if (!complete) throw Error("Incomplete PostHog issue snapshot");
  const spikes: Spike[] = [];
  for (let index = 0; index < candidates.length; index += 4) {
    const group = await Promise.all(
      candidates.slice(index, index + 4).map(async (candidate) => {
        const detail = (await read("query-error-tracking-issue", {
          issueId: candidate.issue,
          dateRange: baseline,
          filterTestAccounts: true,
        })) as {
          status: string;
          impact: { occurrences?: number };
          trend: unknown;
        };
        if (!activeIssue(detail?.status)) return;
        const prior = count(
          Object.keys(detail.impact).length === 0 && detail.trend === null
            ? 0
            : detail.impact.occurrences!,
        );
        if (policy.qualifies(candidate.users, candidate.occurrences, prior))
          return { ...candidate, baseline: prior };
      }),
    );
    for (const spike of group) if (spike) spikes.push(spike);
  }
  return spikes;
}

export async function spikeScanner(
  c: Config,
  store: Store,
  shutdown: AbortSignal,
) {
  if (!c.spikePolicyPath) return undefined;
  const { default: policy } = (await import(
    pathToFileURL(c.spikePolicyPath).href
  )) as { default: SpikePolicy };
  if (
    typeof policy?.admits !== "function" ||
    typeof policy?.qualifies !== "function"
  )
    throw Error("Invalid spike policy module");
  let next = 0;
  return async (now: number) => {
    if (now < next) return;
    next = now + interval;
    const signal = AbortSignal.any([shutdown, AbortSignal.timeout(25000)]);
    const read: Read = async (tool, args) => {
      signal.throwIfAborted();
      return JSON.parse(await posthogRead(c, tool, args, signal));
    };
    store.recordSpikes(
      await readSpikes(read, now, policy),
      c.queueLimit,
      policy,
    );
  };
}
