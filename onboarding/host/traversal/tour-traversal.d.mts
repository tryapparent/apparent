type Step = {
  $:
    | "TourWelcome"
    | "TourHowItWorks"
    | "TourPermissions"
    | "TourShortcut"
    | "TourTryIt"
    | "TourDone";
};

type Primary = { $: "TourStay" | "TourAdvance" | "TourClose" };

declare const traversal: {
  hide_practice_coach(
    practice: boolean,
    boardVisible: boolean,
    boardStep: boolean,
    preparing: boolean,
  ): boolean;
  visible(step: Step, permissionsReady: boolean): boolean;
  enter(step: Step, permissionsReady: boolean): Step;
  advance(
    step: Step,
    repair: boolean,
    permissionsReady: boolean,
  ): { $: "TourGo"; step: Step } | { $: "TourDismiss" };
  back(step: Step, repair: boolean, permissionsReady: boolean): Step;
  primary(
    step: Step,
    permissionsReady: boolean,
    practice: boolean,
    chosen: boolean,
    tested: boolean,
    editing: boolean,
  ): Primary;
  resume_capture(step: Step, practice: boolean, completed: boolean): Step;
};

export default traversal;
