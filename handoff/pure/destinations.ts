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

export const destinationLabels: Record<DestinationKind, string> = {
  new: "New",
  pinned: "Pinned",
  active: "Active",
  done: "Done",
  working: "Working",
  snoozed: "Snoozed",
  settled: "Settled",
};

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
