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
  practice_control(
    step: Step,
    recording: boolean,
    targetStage: boolean,
  ): boolean;
  resume_capture(step: Step, practice: boolean, completed: boolean): Step;
};

export default traversal;
