/** First-capture lesson policy. Only the host calls observe/complete/openedBundle;
 * renderer commands are deliberately a separate, receipt-free interface. */
export type Stage = 'start' | 'screen' | 'whiteboard' | 'board-ink' | 'note'
  | 'screen-ink' | 'stop' | 'preparing' | 'copied' | 'paste' | 'locate'
  | 'complete' | 'retry' | 'copy-failed';

export interface CaptureIdentity {
  generation: string;
  captureId: string;
  requestId: string | null;
}
export interface Scope { session: string; transport: string }
export interface Observation {
  attempt: string;
  sequence: number;
  capture: CaptureIdentity | null;
  phase: 'selecting' | 'recording' | 'processing' | 'cancelled';
  boardVisible: boolean;
  boardInk: boolean;
  screenInk: number;
  /** A nonempty durable save in this capture's native notes session. */
  noteSaved: boolean;
}
export interface Completion {
  capture: CaptureIdentity;
  outcome: { kind: 'saved'; bundlePath: string } | { kind: 'failed'; message: string };
  clipboard: 'notRequested' | 'copied' | 'failed';
  current: boolean;
}
export interface CommandContext extends Scope { attempt: string; revision: number }
export type Command = 'practice-paste' | 'practice-pasted' | 'practice-locate' | 'practice-finish';
export type Effect =
  | { kind: 'close-whiteboard'; capture: CaptureIdentity }
  | { kind: 'complete'; capture: CaptureIdentity; bundlePath: string };
export interface View {
  stage: Stage;
  context: CommandContext;
  savedBundle: boolean;
}

function sameCapture(a: CaptureIdentity | null, b: CaptureIdentity): boolean {
  return a !== null && a.generation === b.generation && a.captureId === b.captureId
    && a.requestId === b.requestId;
}
const recordingStages: ReadonlySet<Stage> = new Set(['whiteboard', 'board-ink', 'note', 'screen-ink', 'stop']);

/** One presentation lifetime. Revocation never stops or reclassifies a capture. */
export class PracticeWorkflow {
  private stage: Stage = 'start';
  private revision = 0;
  private attempt = '';
  private sequence = -1;
  private capture: CaptureIdentity | null = null;
  private boardInk = false;
  private screenInk = false;
  private noteSaved = false;
  private screenBaseline = 0;
  private pasted = false;
  private bundlePath: string | null = null;
  private revoked = false;
  private finished = false;
  private completionReceived = false;
  private scope: Scope;

  constructor(scope: Scope) { this.scope = { ...scope }; }

  get view(): View {
    return { stage: this.stage, context: { ...this.scope, attempt: this.attempt, revision: this.revision }, savedBundle: this.bundlePath !== null };
  }

  /** Called only by the host for a newly admitted local practice attempt. */
  begin(attempt: string): void {
    if (this.revoked || !attempt || attempt === this.attempt) return;
    this.attempt = attempt;
    this.sequence = -1;
    this.capture = null;
    this.boardInk = this.screenInk = this.noteSaved = this.pasted = false;
    this.screenBaseline = 0;
    this.bundlePath = null;
    this.finished = this.completionReceived = false;
    // Even start -> start must invalidate commands from the previous attempt.
    this.revision++;
    this.setStage('start');
  }

  revoke(): void { this.revoked = true; this.revision++; }

  observe(fact: Observation): Effect[] {
    if (this.revoked || !this.attempt || fact.attempt !== this.attempt
      || !Number.isSafeInteger(fact.sequence) || fact.sequence <= this.sequence
      || !Number.isSafeInteger(fact.screenInk) || fact.screenInk < 0) return [];
    if (this.capture && (!fact.capture || !sameCapture(this.capture, fact.capture))) return [];
    // Once a final result arrived, delayed live observations cannot revive it.
    if (this.completionReceived || this.stage === 'retry') return [];
    this.sequence = fact.sequence;
    if (fact.phase === 'cancelled') {
      this.setStage('retry');
      return [];
    }
    if (fact.phase === 'selecting') {
      if (this.stage === 'start') this.setStage('screen');
      return [];
    }
    if (!fact.capture) return [];
    if (fact.phase === 'recording' && (this.stage === 'start' || this.stage === 'screen')) {
      this.capture = { ...fact.capture };
      this.setStage('whiteboard');
    }
    if (!sameCapture(this.capture, fact.capture)) return [];
    if (this.stage === 'whiteboard' && fact.boardVisible) this.setStage('board-ink');
    else if (this.stage === 'board-ink' && !fact.boardVisible) this.setStage('whiteboard');

    const effects: Effect[] = [];
    if (this.stage === 'board-ink' && fact.boardInk) {
      this.boardInk = true;
      this.screenBaseline = fact.screenInk;
      this.setStage('note');
      effects.push({ kind: 'close-whiteboard', capture: { ...fact.capture } });
    } else if (this.stage === 'note') {
      // Screen ink from before the durable note receipt never counts for the next lesson.
      this.screenBaseline = fact.screenInk;
      if (fact.noteSaved) {
        this.noteSaved = true;
        this.setStage('screen-ink');
      }
    } else if (this.stage === 'screen-ink' && fact.screenInk > this.screenBaseline) {
      this.screenInk = true;
      this.setStage('stop');
    }
    if (fact.phase === 'processing' && recordingStages.has(this.stage)) this.setStage('preparing');
    // A late save while stopping is truthful, but cannot invent later screen ink.
    if (this.stage === 'preparing' && this.boardInk && fact.noteSaved) this.noteSaved = true;
    return effects;
  }

  complete(receipt: Completion): void {
    if (this.revoked || !receipt.current || !sameCapture(this.capture, receipt.capture)
      || this.completionReceived || this.stage === 'retry') return;
    if (receipt.outcome.kind === 'failed') {
      this.completionReceived = true;
      this.setStage('retry');
      return;
    }
    if (!receipt.outcome.bundlePath || !(recordingStages.has(this.stage) || this.stage === 'preparing')) return;
    this.completionReceived = true;
    this.bundlePath = receipt.outcome.bundlePath;
    this.setStage(receipt.clipboard === 'copied' ? 'copied' : 'copy-failed');
  }

  /** Only a real shell open receipt for this attempt's saved bundle counts. */
  openedBundle(capture: CaptureIdentity, bundlePath: string): void {
    if (this.revoked || this.stage !== 'locate' || !sameCapture(this.capture, capture)
      || bundlePath !== this.bundlePath) return;
    this.setStage(this.boardInk && this.screenInk && this.noteSaved && this.pasted ? 'complete' : 'retry');
  }

  command(action: string, context: CommandContext): Effect[] {
    if (this.revoked || !this.attempt || context.session !== this.scope.session
      || context.transport !== this.scope.transport || context.attempt !== this.attempt
      || context.revision !== this.revision) return [];
    switch (action) {
      case 'practice-paste':
        if (this.stage === 'copied') this.setStage('paste');
        break;
      case 'practice-pasted':
        if (this.stage === 'paste') { this.pasted = true; this.setStage('locate'); }
        break;
      case 'practice-locate':
        if (this.stage === 'copy-failed') this.setStage('locate');
        break;
      case 'practice-finish':
        if (this.stage === 'complete' && this.capture && this.bundlePath && !this.finished) {
          this.finished = true;
          return [{ kind: 'complete', capture: { ...this.capture }, bundlePath: this.bundlePath }];
        }
    }
    return [];
  }

  private setStage(stage: Stage): void {
    if (this.stage !== stage) { this.stage = stage; this.revision++; }
  }
}
