/** Post-publication policy only. Native owns finalization, receipts and effect admission. */
export type Capture = Readonly<{generation: string; captureId: string; requestId: string | null}>;
export type Outcome = Readonly<{kind: 'saved'; bundlePath: string} | {kind: 'failed'; message: string}>;
export type Observation = Readonly<{
  capture: Capture; outcome: Outcome; clipboard: 'notRequested' | 'copied' | 'failed'; current: boolean;
}>;
export type Context = Readonly<{
  capture: Capture;
  platform: 'linux' | 'macos';
  source: 'screen' | 'phone';
  agentRequested: boolean;
  automaticTrialEnabled: boolean;
  pasteOnRelease?: boolean;
  lab: boolean;
  hyprland: boolean;
  wayland: boolean;
  imageQualityWarning?: string | null;
}>;
export type State = Readonly<{
  context: Context;
  observation: Observation | null;
  current: boolean;
  connected: boolean;
  copyPending: boolean;
  status: string | null;
  manualRecovery: boolean;
  notifications: readonly Readonly<{title: string; body: string}>[];
}>;
export type Event =
  | {type: 'finalized'; capture: Capture; outcome: Outcome}
  | {type: 'clipboard'; capture: Capture; result: 'copied' | 'failed'}
  | {type: 'dismiss' | 'cancel' | 'revoke' | 'disconnect' | 'reconnect'};
export type Effect = Readonly<{type: 'copy'; capture: Capture; mode: 'text' | 'bundle' | 'autoPasteDraft' | 'autoPasteAndSubmit'}>;
export type Decision = Readonly<{state: State; effects: readonly Effect[]}>;

export function begin(context: Context, current: boolean): State {
  return {context, observation: null, current, connected: true, copyPending: false, status: null, manualRecovery: false, notifications: []};
}
export function sameCapture(a: Capture, b: Capture): boolean {
  return a.generation === b.generation && a.captureId === b.captureId && a.requestId === b.requestId;
}
export type CopyPolicy = {
  may_copy(saved: boolean, current: boolean, connected: boolean): boolean;
  copy_mode(localScreen: boolean, hyprland: boolean, wayland: boolean, draft: boolean, submit: boolean): 0 | 1 | 2;
};
const modes = ['bundle', 'autoPasteDraft', 'autoPasteAndSubmit'] as const;

export function reduce(previous: State, event: Event, policy: CopyPolicy): Decision {
  let state = previous;
  const context = state.context;
  const mode = modes[policy.copy_mode(
    context.platform === 'linux' && context.source === 'screen' && !context.agentRequested && !context.lab,
    context.hyprland, context.wayland, context.pasteOnRelease === true, context.automaticTrialEnabled,
  )];
  const automatic = mode !== 'bundle';
  const effects: Effect[] = [];
  if (event.type === 'dismiss' || event.type === 'cancel' || event.type === 'revoke') {
    state = {...state, current: false, copyPending: false,
      observation: state.observation && {...state.observation, current: false}};
  } else if (event.type === 'disconnect') {
    // A lost effect acknowledgement must never cause an automatic repeat write.
    state = {...state, connected: false, copyPending: false};
  } else if (event.type === 'reconnect') {
    state = {...state, connected: true};
  } else if ('capture' in event && sameCapture(state.context.capture, event.capture)) {
    if (event.type === 'finalized' && !state.observation) {
      const copyPending = policy.may_copy(event.outcome.kind === 'saved', state.current, state.connected);
      state = {...state, observation: {capture: state.context.capture, outcome: event.outcome,
        clipboard: 'notRequested', current: state.current},
        copyPending,
        notifications: copyPending && state.context.platform === 'linux'
          && state.context.imageQualityWarning
          ? [{title: 'Capture image quality warning', body: state.context.imageQualityWarning}] : [],
        status: event.outcome.kind === 'saved' ? 'Saved' : event.outcome.message.startsWith('No screen frames were captured')
          ? 'Capture failed — no screen frames' : 'Capture failed'};
      if (state.copyPending) effects.push({type: 'copy', capture: state.context.capture,
        mode});
    } else if (event.type === 'clipboard' && state.copyPending && state.observation?.outcome.kind === 'saved') {
      state = {...state, copyPending: false, observation: {...state.observation, clipboard: event.result},
        manualRecovery: event.result === 'failed' && !automatic,
        status: event.result === 'failed' ? automatic ? 'Saved · auto paste stopped' : 'Saved · open bundle (copy failed)'
          : mode === 'autoPasteAndSubmit' ? 'Saved · Enter pressed' : mode === 'autoPasteDraft' ? 'Saved · paste dispatched' : 'Saved · copied',
        notifications: automatic ? [...state.notifications, {title: 'Auto paste', body: event.result === 'failed'
          ? 'Auto paste stopped. Check your composer before retrying from the saved bundle.'
          : `${mode === 'autoPasteAndSubmit' ? 'Image and text paste dispatched, then Enter pressed' : 'Draft paste dispatched'}. Check your composer for the result. Saved capture: ${state.observation.outcome.bundlePath}`}] : state.notifications};
    }
  }
  return {state, effects};
}
