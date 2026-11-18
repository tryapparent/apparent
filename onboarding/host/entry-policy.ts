export type Launch = "quiet" | "tour" | "repair";

export function launch(
  seen: boolean,
  deferred: boolean,
  reopeningRepair: boolean,
  offerTour: boolean,
): Launch {
  if (reopeningRepair) return "repair";
  if (offerTour && !seen && !deferred) return "tour";
  return "quiet";
}
