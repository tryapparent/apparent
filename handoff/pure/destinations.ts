export type DestinationKind =
  | "new"
  | "pinned"
  | "active"
  | "done"
  | "working"
  | "snoozed"
  | "settled";

export type Destination = {
  id: string;
  title: string;
  project: string;
  computer?: string;
  kind: DestinationKind;
};

export type DestinationView = {
  capture: string;
  choices: Destination[];
  selected: string;
  confirmed?: Destination;
  phase:
    | "setup"
    | "choosing"
    | "armed"
    | "sending"
    | "sent"
    | "error"
    | "uncertain";
  processing: boolean;
  error?: string;
};

export type Thread = {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  unsettledAt?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  settledOverride?: string | null;
  settledAt?: string | null;
  pinnedAt?: string | null;
  pinOrderKey?: string | null;
  activeOrderKey?: string | null;
  snoozedUntil?: string | null;
  lastSnoozeWakeAt?: string | null;
  lineage?: { relationshipToParent?: string | null };
  status?: string;
  session?: { status?: string | null } | null;
  latestTurn?: { state?: string | null } | null;
  backgroundLiveness?: string | null;
};

export type Project = {
  id: string;
  title: string;
  createdAt?: string;
  archivedAt?: string | null;
};

export const destinationLabels: Record<DestinationKind, string> = {
  new: "New",
  pinned: "Pinned",
  active: "Active",
  done: "Done",
  working: "Working",
  snoozed: "Snoozed",
  settled: "Settled",
};

const working = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);
const shelf: Record<DestinationKind, number> = {
  new: 0,
  pinned: 1,
  active: 2,
  done: 2,
  working: 3,
  snoozed: 4,
  settled: 5,
};

function kind(thread: Thread, now: number): DestinationKind {
  if (
    thread.settledOverride === "settled" ||
    (thread.settledAt && thread.settledOverride !== "active")
  )
    return "settled";
  if (timestamp(thread.snoozedUntil) > now) return "snoozed";
  if (thread.pinnedAt) return "pinned";
  if (
    working.has(thread.session?.status ?? thread.status ?? "") ||
    thread.latestTurn?.state === "running" ||
    thread.backgroundLiveness === "working"
  )
    return "working";
  return thread.latestTurn?.state === "completed" ? "done" : "active";
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const timestamp = (value?: string | null) =>
  value ? Date.parse(value) || 0 : 0;
const activity = (thread: Thread) =>
  Math.max(
    timestamp(thread.createdAt),
    timestamp(thread.unsettledAt),
    timestamp(thread.lastSnoozeWakeAt),
  );

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
  const rows = threads
    .filter(
      (thread) =>
        !thread.archivedAt &&
        !thread.deletedAt &&
        thread.lineage?.relationshipToParent !== "subagent" &&
        names.has(thread.projectId),
    )
    .map((thread) => ({ thread, kind: kind(thread, now) }));
  rows.sort((a, b) => {
    const group = shelf[a.kind] - shelf[b.kind];
    if (group) return group;
    const left = a.thread;
    const right = b.thread;
    const tie = compare(left.id, right.id);
    if (a.kind === "snoozed")
      return (
        timestamp(left.snoozedUntil) - timestamp(right.snoozedUntil) || tie
      );
    if (a.kind === "settled")
      return (
        (timestamp(right.settledAt) || timestamp(right.updatedAt)) -
          (timestamp(left.settledAt) || timestamp(left.updatedAt)) || tie
      );
    const pinned = a.kind === "pinned";
    const leftKey = pinned ? left.pinOrderKey : left.activeOrderKey;
    const rightKey = pinned ? right.pinOrderKey : right.activeOrderKey;
    if (leftKey !== rightKey) {
      if (leftKey && rightKey) return compare(leftKey, rightKey);
      if (leftKey || rightKey) return leftKey ? -1 : 1;
    }
    return (
      (pinned
        ? timestamp(right.pinnedAt) - timestamp(left.pinnedAt)
        : activity(right) - activity(left)) || tie
    );
  });
  return [
    {
      id: "new",
      title: "New thread",
      project: names.get(projectId) ?? "",
      kind: "new",
    },
    ...rows.map(({ thread, kind }) => ({
      id: thread.id,
      title: thread.title,
      project: names.get(thread.projectId)!,
      kind,
    })),
  ];
}

export function filterDestinations(
  choices: readonly Destination[],
  query: string,
) {
  const terms = query.trim().toLowerCase().split(/\s+/);
  return choices.filter((choice) => {
    const searchable = [
      choice.title,
      choice.computer,
      choice.project,
      destinationLabels[choice.kind],
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}
