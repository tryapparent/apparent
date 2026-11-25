import type { RegisteredPreferenceId } from "./preference-ids.ts";

type PaneOf<Id extends string> = Id extends `${infer Pane}.${string}`
  ? Pane
  : never;
export type PreferencePane = PaneOf<RegisteredPreferenceId>;
export type PreferenceId<Pane extends PreferencePane = PreferencePane> =
  Extract<RegisteredPreferenceId, `${Pane}.${string}`>;

export function bindPreference<
  Pane extends PreferencePane,
  Args extends unknown[],
  Result,
>(
  pane: Pane,
  id: PreferenceId<NoInfer<Pane>>,
  change: (...args: Args) => Result,
): (...args: Args) => Result {
  if (!id.startsWith(`${pane}.`))
    throw Error(`Invalid Settings binding: ${id}`);
  return change;
}
