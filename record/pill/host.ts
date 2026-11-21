import type {
  CompletionCopy,
  Facts,
  Surface,
  SurfaceFacts,
} from "./presentation.ts";
import { presentation } from "./presentation.ts";

type Tag<T extends string> = Readonly<{ $: T }>;
type Mode = Tag<"Area" | "Screen" | "Iphone" | "Window">;
type Reveal =
  | Tag<"Closed">
  | Readonly<
      Tag<"Open"> & {
        min_at: number;
        idle_at: number;
        leave_at: number;
        hovered: boolean;
        working: boolean;
        baseline: number;
      }
    >;
type Phase =
  | Tag<"Hidden" | "Dismissing">
  | Readonly<Tag<"Processing"> & { released: boolean }>
  | Readonly<Tag<"Selecting"> & { mode: Mode }>
  | Readonly<Tag<"Recording"> & { reveal: Reveal }>
  | Readonly<
      Tag<"Completed"> & {
        result: Readonly<
          Tag<"Result"> & {
            dismiss_at: number;
            recovery: boolean;
            sharing: boolean;
            consent: boolean;
            copy: Tag<CompletionCopy>;
          }
        >;
      }
    >;

export type PillEvent =
  | Tag<
      | "CaptureStarted"
      | "CaptureSealed"
      | "SourceReleased"
      | "CaptureFailed"
      | "Dismiss"
      | "SurfaceHidden"
      | "Hide"
      | "RevealClosed"
      | "ShareStarted"
      | "Deadline"
      | "OnlineObserved"
    >
  | Readonly<Tag<"PickerOpened" | "ModeSelected"> & { mode: Mode }>
  | Readonly<Tag<"CaptureSaved"> & { recovery: boolean; text?: string }>
  | Readonly<
      Tag<"CompletionText"> & { copy: Tag<CompletionCopy>; text?: string }
    >
  | Readonly<Tag<"ActivityObserved" | "RevealOpened"> & { activity: number }>
  | Readonly<Tag<"PointerChanged"> & { inside: boolean }>
  | Readonly<Tag<"ShareEnded"> & { renew: boolean }>
  | Readonly<Tag<"ConsentChanged"> & { open: boolean }>;

export type Kernel = Readonly<{
  step(event: PillEvent, phase: Phase, time: number): Phase;
  deadline(
    phase: Phase,
    time: number,
  ): Tag<"NoDeadline"> | Readonly<Tag<"WakeAt"> & { time: number }>;
  present(phase: Phase, facts: SurfaceFacts): Surface;
  reached(now: number, at: number): boolean;
}>;

export type Snapshot = Readonly<{
  phase: Phase["$"];
  mode: Mode["$"] | null;
  reveal: boolean;
  wakeInMs: number | null;
}>;

export function createPill(kernel: Kernel) {
  let state: Phase = { $: "Hidden" };
  let completion: string | null = null;
  function dispatch(
    event: PillEvent,
    now: number,
    animationNow = now,
  ): Snapshot {
    const time = state.$ === "Recording" ? animationNow : now;
    if (!Number.isSafeInteger(time) || time < 0)
      throw new RangeError("Invalid monotonic pill clock");
    const tick = time >>> 0;
    const next = kernel.step(event, state, tick);
    const wake = kernel.deadline(next, tick);
    const result = {
      phase: next.$,
      mode: next.$ === "Selecting" ? next.mode.$ : null,
      reveal: next.$ === "Recording" && next.reveal.$ === "Open",
      wakeInMs:
        wake.$ === "WakeAt"
          ? kernel.reached(tick, wake.time)
            ? 0
            : (wake.time - tick) >>> 0
          : null,
    };
    if (next.$ === "Completed") {
      if (event.$ === "CaptureSaved" && state.$ !== "Completed")
        completion = event.text ?? null;
      if (event.$ === "CompletionText") completion = event.text ?? null;
      if (
        event.$ === "OnlineObserved" &&
        state.$ === "Completed" &&
        state.result.copy.$ === "Offline"
      )
        completion = null;
    } else {
      completion = null;
    }
    state = next;
    return result;
  }
  function present(facts: Facts) {
    return presentation(
      kernel.present(state, {
        $: "Facts",
        phone: facts.phone,
        no_words: facts.noWords,
        note_count: facts.noteCount,
        movable: facts.movable,
        paste: facts.paste,
        inspect: facts.inspect,
        sharing_enabled: facts.sharingEnabled,
        sharing_online: facts.sharingOnline,
        microphone_problem: facts.microphoneProblem,
        audio_problem: facts.audioProblem,
      }),
      facts,
      completion,
    );
  }
  return { dispatch, present };
}

type NativeEvent =
  | Exclude<PillEvent, { mode: Mode } | { copy: Tag<CompletionCopy> }>
  | Readonly<Tag<"PickerOpened" | "ModeSelected"> & { mode: Mode["$"] }>
  | Readonly<Tag<"CompletionText"> & { copy: CompletionCopy; text?: string }>;

export function nativePill(kernel: Kernel) {
  const { dispatch, present } = createPill(kernel);
  function dispatchNative(
    input: string,
    now: number,
    animationNow = now,
  ): string {
    const event: NativeEvent = JSON.parse(input);
    const observation =
      "mode" in event
        ? { ...event, mode: { $: event.mode } }
        : "copy" in event
          ? { ...event, copy: { $: event.copy } }
          : event;
    return JSON.stringify(dispatch(observation, now, animationNow));
  }
  function presentNative(input: string): string {
    return JSON.stringify(present(JSON.parse(input)));
  }
  return { dispatchNative, presentNative };
}
