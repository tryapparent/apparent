/** Electron main-process lesson authority, ported from practice.rs blob
 * 1cb1b835730329712f263b1deb4782a2c57fc0c9.
 * Pure policy; input admission belongs to the trusted native/host boundary.
 * Native observations below MUST NOT be exposed through renderer IPC.
 */
export const stages = ['start', 'screen', 'whiteboard', 'board-ink', 'note', 'screen-ink',
  'stop', 'preparing', 'copied', 'paste', 'locate', 'complete', 'retry', 'copy-failed'] as const;
export type Stage = typeof stages[number];
export type Practice = Readonly<{
  stage: Stage; boardInk: boolean; screenInk: boolean; latest: boolean;
  screenBaseline: number; pasted: boolean;
}>;
export type Observation =
  | {type: 'selecting' | 'started' | 'whiteboard' | 'processing' | 'cancelled' | 'opened-latest'}
  | {type: 'whiteboard-visible'; visible: boolean}
  | {type: 'ink'; board: boolean; screen: number}
  | {type: 'note'; saved: boolean}
  | {type: 'saved'; copied: boolean};
export type Event = Observation | {type: 'action'; action: string};
export function initialPractice(): Practice {
  return {stage: 'start', boardInk: false, screenInk: false, latest: false,
    screenBaseline: 0, pasted: false};
}
/** accepted is exactly Rust action()'s bool, false for non-action observations.
 * No finish/persist effect is executed here. Session eligibility remains native.
 * screen is a native nonnegative stroke count, validated before calling.
 */
export function reducePractice(state: Practice, event: Event): {state: Practice; accepted: boolean} {
  let next = state;
  let accepted = false;
  const stage = state.stage;
  switch (event.type) {
    case 'selecting':
      if (stage !== 'screen') next = {...initialPractice(), stage: 'screen'};
      break;
    case 'started':
      if (['start', 'screen', 'retry', 'copy-failed'].includes(stage))
        next = {...initialPractice(), stage: 'whiteboard'};
      break;
    case 'whiteboard':
      if (stage === 'whiteboard') next = {...state, stage: 'board-ink'};
      break;
    case 'whiteboard-visible':
      if (event.visible && stage === 'whiteboard') next = {...state, stage: 'board-ink'};
      else if (!event.visible && stage === 'board-ink') next = {...state, stage: 'whiteboard'};
      break;
    case 'ink':
      if (stage === 'board-ink' && event.board)
        next = {...state, boardInk: true, screenBaseline: event.screen, stage: 'screen-ink'};
      else if (stage === 'note')
        next = {...state, screenBaseline: event.screen, stage: 'screen-ink'};
      else if (stage === 'screen-ink' && event.screen > state.screenBaseline)
        next = {...state, screenInk: true, stage: 'stop'};
      break;
    case 'note': break; // Retained native callback; never a coaching gate.
    case 'processing':
      if (['whiteboard', 'board-ink', 'screen-ink', 'note', 'stop'].includes(stage))
        next = {...state, stage: 'preparing'};
      break;
    case 'saved':
      if (stage === 'preparing') next = {...state, stage: event.copied ? 'copied' : 'copy-failed'};
      break;
    case 'cancelled':
      if (['screen', 'whiteboard', 'board-ink', 'screen-ink', 'note', 'stop', 'preparing'].includes(stage))
        next = {...state, stage: 'retry'};
      break;
    case 'action':
      if (stage === 'copied' && event.action === 'practice-paste') {
        next = {...state, stage: 'paste'}; accepted = true;
      } else if (stage === 'paste' && event.action === 'practice-pasted') {
        next = {...state, pasted: true, stage: 'locate'}; accepted = true;
      } else if (stage === 'copy-failed' && event.action === 'practice-locate') {
        next = {...state, stage: 'locate'}; accepted = true;
      } else if (stage === 'complete' && event.action === 'practice-finish') accepted = true;
      break;
    case 'opened-latest':
      if (stage === 'locate') next = {...state, latest: true,
        stage: state.boardInk && state.screenInk && state.pasted ? 'complete' : 'retry'};
      break;
  }
  return {state: next, accepted};
}
