type Stamp = { $: "Stamp"; hi: number; lo: number };
type Runtime = { $: "Idle" | "Busy" | "Failed" | "Other" };

declare const policy: {
  inbox_done(shelf: number, completed: boolean): boolean;
  reuse_destination(sameDestination: boolean, isNew: boolean): boolean;
  destination_rank(
    now: Stamp,
    placement: {
      $: "Placement";
      snooze: Stamp;
      snoozed_at: Stamp;
      settled: boolean;
      pinned: boolean;
      pin_key: boolean;
    },
    attention: {
      $: "Attention";
      approval: boolean;
      question: boolean;
      question_at: Stamp;
      subagent: boolean;
      guest: boolean;
      plan: boolean;
    },
    activity: {
      $: "Activity";
      runtime: Runtime;
      background: boolean;
      runtime_at: Stamp;
      stopped_plan: boolean;
      created: Stamp;
      unsettled: Stamp;
      requested: Stamp;
      started: Stamp;
      completed: Stamp;
      authored_available: boolean;
      authored: Stamp;
      latest_user: Stamp;
      updated: Stamp;
      settled_at: Stamp;
    },
  ): { $: "Rank"; shelf: 0 | 1 | 2 | 3 | 4; tier: number; stamp: Stamp };
};
export default policy;
