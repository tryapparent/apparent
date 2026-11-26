type Share =
  | Tag<"NoShare" | "ShareDisabled" | "ShareAvailable" | "ShareUploading">
  | Readonly<Tag<"ShareRetry"> & { enabled: boolean }>;
export type CompletionCopy =
  | "Ordinary"
  | "Offline"
  | "Uploading"
  | "UploadStopped"
  | "ShareReceipt";
export type ShareIndicator = "none" | "uploading" | "retry" | "receipt";

export type Facts = Readonly<{
  phone: boolean;
  noWords: boolean;
  noteCount: number;
  movable: boolean;
  paste: boolean;
  inspect: boolean;
  sharingEnabled: boolean;
  sharingOnline: boolean;
  micWarning: string | null;
  audioIssue: string | null;
  microphoneProblem: boolean;
  screenStarting?: boolean;
  audioProblem: boolean;
}>;

type Tag<T extends string> = Readonly<{ $: T }>;
type Mode = "Area" | "Screen" | "Iphone" | "Window";
export type Surface =
  | Tag<"HiddenSurface">
  | Readonly<
      Tag<"PickerSurface"> & {
        mode: Tag<Mode>;
        can_record: boolean;
        phone: boolean;
      }
    >
  | Readonly<
      Tag<"RecordingSurface"> & {
        no_words: boolean;
        notes: number;
        movable: boolean;
        finish_primary: boolean;
      }
    >
  | Tag<"StartingSurface" | "ProcessingSurface">
  | Readonly<
      Tag<"CompletedSurface"> & {
        paste: boolean;
        inspect: boolean;
        share: Share;
        copy: Tag<CompletionCopy>;
        audio_problem: boolean;
      }
    >;

export type SurfaceFacts = Readonly<
  Tag<"Facts"> & {
    phone: boolean;
    no_words: boolean;
    note_count: number;
    movable: boolean;
    paste: boolean;
    inspect: boolean;
    sharing_enabled: boolean;
    sharing_online: boolean;
    microphone_problem: boolean;
    audio_problem: boolean;
    screen_starting: boolean;
  }
>;

type Action = Readonly<{
  id: string;
  label: string;
  enabled: boolean;
  selected: boolean;
  primary: boolean;
}>;

export type Presentation = Readonly<{
  phase: "hidden" | "selecting" | "recording" | "processing" | "completed";
  label: string;
  warning: string | null;
  micWarning: string | null;
  actions: readonly Action[];
  noteCount: number;
  noWords: boolean;
  completedWarning: boolean;
  draggable: boolean;
  shareIndicator: ShareIndicator;
}>;

export function presentation(
  surface: Surface,
  facts: Facts,
  completion: string | null,
): Presentation {
  const actions: Action[] = [];
  const result = {
    actions,
    warning: facts.micWarning,
    micWarning: null,
    noteCount: 0,
    noWords: false,
    completedWarning: false,
    draggable: false,
    shareIndicator: "none" as ShareIndicator,
  };
  function control(
    id: string,
    label: string,
    enabled = true,
    selected = false,
    primary = false,
  ) {
    actions.push({ id, label, enabled, selected, primary });
  }
  function modes(phone: boolean, selected: Mode) {
    control("select-area", "Area", true, selected === "Area");
    control("select-screen", "Screen", true, selected === "Screen");
    if (phone)
      control("select-iphone", "iPhone", true, selected === "Iphone");
  }
  switch (surface.$) {
    case "HiddenSurface":
      return { ...result, phase: "hidden", label: "" };
    case "PickerSurface":
      modes(surface.phone, surface.mode.$);
      if (surface.can_record) control("record", "Record", true, false, true);
      control("cancel", "Cancel");
      return { ...result, phase: "selecting", label: "Choose what to record" };
    case "StartingSurface":
      control("whiteboard", "Whiteboard", false);
      control("finish", "Finish", false);
      control("cancel", "Cancel");
      return { ...result, phase: "recording", label: "Starting recording…", warning: null };
    case "RecordingSurface":
      control("whiteboard", "Whiteboard");
      control("finish", "Finish", true, false, surface.finish_primary);
      control("cancel", "Cancel");
      if (surface.notes) control("notes", "Open notes");
      return {
        ...result,
        phase: "recording",
        label: "Recording",
        warning: surface.no_words ? "No words recognized yet" : null,
        micWarning: facts.micWarning,
        noteCount: surface.notes,
        noWords: surface.no_words,
        draggable: surface.movable,
      };
    case "ProcessingSurface":
      return { ...result, phase: "processing", label: "Processing recording…" };
    case "CompletedSurface": {
      const label = [completion ?? "Copied", facts.audioIssue]
        .filter(Boolean)
        .join(" · ");
      const sharing = surface.share;
      control("paste", "Paste", surface.paste, false, !surface.audio_problem);
      if (sharing.$ === "ShareUploading") {
        control("copy-link", "Cancel upload");
        result.shareIndicator = "uploading";
      } else if (sharing.$ !== "NoShare") {
        const retry = sharing.$ === "ShareRetry";
        control(
          "copy-link",
          retry ? "Retry upload" : "Public link",
          retry ? sharing.enabled : sharing.$ !== "ShareDisabled",
        );
        result.shareIndicator = retry
          ? "retry"
          : surface.copy.$ === "ShareReceipt"
            ? "receipt"
            : "none";
      }
      control("inspect", "Inspect", surface.inspect);
      control("dismiss", "Dismiss");
      return {
        ...result,
        phase: "completed",
        label,
        completedWarning: surface.audio_problem,
        warning: surface.audio_problem ? label : result.warning,
      };
    }
  }
}
