import order from "../pure/destination-order.mjs";
import type { Destination } from "../pure/destinations.ts";
import type { Job } from "./delivery.ts";
import { Transport, type Connection } from "./transport.ts";

const shelves = ["pinned", "active", "working", "snoozed", "settled"] as const;

type Stamp = string | null;
type Run = {
  runId?: string;
  status?: string;
  state?: string | null;
  requestedAt?: Stamp;
  startedAt?: Stamp;
  completedAt?: Stamp;
};
type Runtime = {
  status: string;
  activeRunId?: string | null;
  updatedAt?: Stamp;
};
export type Thread = {
  id: string;
  sourceId?: string;
  environmentId?: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  unsettledAt?: Stamp;
  archivedAt?: Stamp;
  deletedAt?: Stamp;
  settledOverride?: string | null;
  settledAt?: Stamp;
  pinnedAt?: Stamp;
  activeOrderKey?: string | null;
  pinOrderKey?: string | null;
  snoozedAt?: Stamp;
  snoozedUntil?: Stamp;
  lineage?: { relationshipToParent?: string | null };
  status?: string;
  activityRunStatus?: string | null;
  activeRunId?: string | null;
  latestRunId?: string | null;
  latestRunRequestedAt?: Stamp;
  latestRunStartedAt?: Stamp;
  latestRunCompletedAt?: Stamp;
  latestRun?: Run | null;
  latestTurn?: Run | null;
  runtime?: Runtime | null;
  session?: Runtime | null;
  latestUserMessageAt?: Stamp;
  latestUserAuthoredMessageAt?: Stamp;
  hasPendingApprovals?: boolean;
  hasPendingUserInput?: boolean;
  pendingUserInputAt?: Stamp;
  pendingSubagentRequest?: "approval" | "user_input" | null;
  pendingGuestMessageCount?: number;
  interactionMode?: string;
  hasActionableProposedPlan?: boolean;
  pendingRuntimeRequest?: { kind: string; createdAt?: Stamp } | null;
  pendingBackgroundTasks?: { kind: string; awaited?: boolean }[];
};
export type Project = {
  id: string;
  title: string;
  createdAt?: string;
  archivedAt?: Stamp;
};

export function preferDestination(choices: Destination[], preferredId: string) {
  const index = choices.findIndex(({ id, kind }) =>
    order.reuse_destination(id === preferredId, kind === "new"),
  );
  if (index > 0) choices.unshift(...choices.splice(index, 1));
}

export async function readDestinationShell(transport: Transport) {
  const [raw, config] = await Promise.all([
    transport.get("/api/orchestration/shell?omitIdleSubagents=1") as Promise<{
      threads: Thread[];
      projects: Project[];
    }>,
    transport.rpc("server.getConfig", {}) as Promise<{
      settings: Record<string, unknown>;
      environment?: { label?: unknown; environmentId?: unknown };
    }>,
  ]);
  if (
    !Array.isArray(raw.threads) ||
    !Array.isArray(raw.projects) ||
    !config.settings
  )
    throw Error("Invalid T3 catalogue");
  return { raw, settings: config.settings, environment: config.environment };
}

export async function loadComputer(config: Connection, recent: Job[]) {
  const { raw, settings, environment } = await readDestinationShell(
    new Transport(config),
  );
  const projects = raw.projects.filter((p) => !p.archivedAt);
  const last = recent.find(
    ({ target }) =>
      target.origin === config.origin &&
      projects.some((project) => project.id === target.projectId),
  );
  const projectId = [
    last?.target.projectId,
    config.projectId,
    projects[0]?.id,
  ].find((id) => projects.some((p) => p.id === id));
  if (!projectId) throw Error("No T3 project");
  const label = environment?.label;
  return {
    config,
    raw,
    projects,
    projectId,
    last,
    settings,
    label: typeof label === "string" ? label.trim() : "",
    environmentId:
      typeof environment?.environmentId === "string"
        ? environment.environmentId
        : config.origin,
  };
}

type RuntimeTag = "Idle" | "Busy" | "Failed" | "Other";
const runtimeTags = new Map<string, RuntimeTag>([
  ["idle", "Idle"],
  ["preparing", "Busy"],
  ["queued", "Busy"],
  ["starting", "Busy"],
  ["running", "Busy"],
  ["waiting", "Busy"],
  ["error", "Failed"],
  ["failed", "Failed"],
]);
const runtimeTag = (value: string | null | undefined) =>
  runtimeTags.get(value ?? "") ?? "Other";
const terminalStatuses = new Set([
  "idle",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);
const stamp = (value: number) => {
  const time = Math.max(0, value || 0);
  return {
    $: "Stamp",
    hi: Math.floor(time / 0x100000000),
    lo: time >>> 0,
  } as const;
};
const date = (value: Stamp | undefined) => stamp(Date.parse(value ?? ""));
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function rank(thread: Thread, now: ReturnType<typeof stamp>) {
  const source = thread.runtime ?? thread.session;
  const run: Run = thread.latestRun ??
    thread.latestTurn ?? {
      runId: thread.latestRunId ?? undefined,
      status: thread.status,
      requestedAt: thread.latestRunRequestedAt,
      startedAt: thread.latestRunStartedAt,
      completedAt:
        thread.latestRunCompletedAt === undefined &&
        thread.latestRunId &&
        terminalStatuses.has(thread.status ?? "")
          ? thread.updatedAt
          : thread.latestRunCompletedAt,
    };
  const request = thread.pendingRuntimeRequest;
  const status = runtimeTag(
    source?.status ?? thread.activityRunStatus ?? thread.status,
  );
  const background = (thread.pendingBackgroundTasks ?? []).some(
    ({ kind, awaited }) =>
      awaited || kind === "subagent" || kind === "background_task",
  );
  const placement = order.destination_rank(
    now,
    {
      $: "Placement",
      snooze: date(thread.snoozedUntil),
      snoozed_at: date(thread.snoozedAt),
      settled:
        thread.settledOverride === "settled" ||
        (thread.settledOverride === undefined && thread.settledAt != null),
      pinned: thread.pinnedAt != null,
      pin_key: thread.pinOrderKey != null,
    },
    {
      $: "Attention",
      approval:
        thread.hasPendingApprovals === true ||
        (request != null &&
          request.kind !== "user_input" &&
          request.kind !== "auth_refresh"),
      question:
        thread.hasPendingUserInput === true || request?.kind === "user_input",
      question_at: date(thread.pendingUserInputAt ?? request?.createdAt),
      subagent: thread.pendingSubagentRequest != null,
      guest: (thread.pendingGuestMessageCount ?? 0) > 0,
      plan:
        thread.interactionMode === "plan" &&
        thread.hasActionableProposedPlan === true,
    },
    {
      $: "Activity",
      runtime: {
        $:
          !thread.runtime && !thread.latestRunId && status === "Idle"
            ? "Other"
            : status,
      },
      background,
      runtime_at: date(
        run.status === "failed"
          ? run.completedAt
          : (source?.updatedAt ?? thread.updatedAt),
      ),
      stopped_plan:
        run.runId != null &&
        runtimeTag(run.status ?? run.state) !== "Busy" &&
        (source?.activeRunId ?? thread.activeRunId) !== run.runId,
      created: date(thread.createdAt),
      unsettled: date(thread.unsettledAt),
      requested: date(run?.requestedAt),
      started: date(run?.startedAt),
      completed: date(run?.completedAt),
      authored_available: thread.latestUserAuthoredMessageAt !== undefined,
      authored: date(thread.latestUserAuthoredMessageAt),
      latest_user: date(thread.latestUserMessageAt),
      updated: date(thread.updatedAt),
      settled_at: date(thread.settledAt),
    },
  );
  const completed = (run.status ?? run.state) === "completed";
  return {
    ...placement,
    kind: order.inbox_done(placement.shelf, completed)
      ? ("done" as const)
      : shelves[placement.shelf],
  };
}

export function destinations(
  threads: Thread[],
  projects: Project[],
  projectId: string,
  now = Date.now(),
): Destination[] {
  const names = new Map(
    projects
      .filter((project) => !project.archivedAt)
      .map((project) => [project.id, project.title]),
  );
  const clock = stamp(now);
  const rows = threads
    .filter(
      (thread) =>
        !thread.archivedAt &&
        !thread.deletedAt &&
        thread.lineage?.relationshipToParent !== "subagent" &&
        names.has(thread.projectId),
    )
    .map((thread) => ({ thread, rank: rank(thread, clock) }));
  rows.sort((left, right) => {
    const a = left.rank;
    const b = right.rank;
    const first = left.thread;
    const second = right.thread;
    const idA = first.sourceId ?? first.id;
    const idB = second.sourceId ?? second.id;
    return (
      a.shelf - b.shelf ||
      a.tier - b.tier ||
      (a.shelf === 0 && a.tier === 0
        ? compare(first.pinOrderKey ?? "", second.pinOrderKey ?? "")
        : 0) ||
      a.stamp.hi - b.stamp.hi ||
      a.stamp.lo - b.stamp.lo ||
      (a.shelf === 4 ? compare(idA, idB) : idA.localeCompare(idB)) ||
      (first.environmentId ?? "").localeCompare(second.environmentId ?? "")
    );
  });
  return [
    {
      id: "new",
      title: "New thread",
      project: names.get(projectId) ?? "",
      kind: "new",
    },
    ...rows.map(({ thread, rank: placement }) => ({
      id: thread.id,
      title: thread.title,
      project: names.get(thread.projectId)!,
      kind: placement.kind,
    })),
  ];
}
