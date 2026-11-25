import {
  preferenceLocations,
  type RegisteredPreferenceId,
} from "./preference-ids.ts";

type PaneOf<Id extends string> = Id extends keyof typeof preferenceLocations
  ? (typeof preferenceLocations)[Id]
  : Id extends `${infer Pane}.${string}`
    ? Pane
    : never;
export type PreferencePane = PaneOf<RegisteredPreferenceId>;
export type PreferenceId<Pane extends PreferencePane = PreferencePane> = {
  [Id in RegisteredPreferenceId]: PaneOf<Id> extends Pane ? Id : never;
}[RegisteredPreferenceId];

export function bindPreference<
  Pane extends PreferencePane,
  Args extends unknown[],
  Result,
>(
  pane: Pane,
  id: PreferenceId<NoInfer<Pane>>,
  change: (...args: Args) => Result,
): (...args: Args) => Result {
  const location =
    (preferenceLocations as Record<string, string>)[id] ?? id.split(".")[0];
  if (location !== pane) throw Error(`Invalid Settings binding: ${id}`);
  return change;
}
