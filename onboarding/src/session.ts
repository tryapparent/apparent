import { PracticeWorkflow, type CaptureIdentity, type CommandContext, type Completion, type Observation, type Scope, type View } from './practice.ts';
import { PracticeProgress, type PersistenceState, type ProgressPort } from './progress.ts';

/** Capabilities are implemented by the host, never by the renderer. */
export interface PracticePorts {
  progress: ProgressPort;
  closeWhiteboard(capture: CaptureIdentity): void;
  finished(capture: CaptureIdentity, bundlePath: string): void;
}
export interface PracticeView extends View { persistence: PersistenceState }

/** The real host and headless tests compose exactly this controller. */
export class PracticeSession {
  private readonly workflow: PracticeWorkflow;
  private readonly ports: PracticePorts;
  private progress: PracticeProgress;
  private completion: { capture: CaptureIdentity; bundlePath: string } | null = null;
  private closed = false;
  private finishing: Promise<void> | null = null;

  constructor(scope: Scope, ports: PracticePorts) {
    this.workflow = new PracticeWorkflow(scope);
    this.ports = ports;
    this.progress = new PracticeProgress(ports.progress);
  }
  get view(): PracticeView { return { ...this.workflow.view, persistence: this.progress.state }; }

  async begin(attempt: string): Promise<void> {
    if (this.closed || !attempt || this.workflow.view.context.attempt === attempt) return;
    this.progress.close();
    this.progress = new PracticeProgress(this.ports.progress);
    this.completion = null;
    this.finishing = null;
    this.workflow.begin(attempt);
    await this.progress.load();
  }

  observe(fact: Observation): void {
    for (const effect of this.workflow.observe(fact)) {
      if (effect.kind === 'close-whiteboard') this.ports.closeWhiteboard(effect.capture);
    }
  }
  complete(receipt: Completion): void { this.workflow.complete(receipt); }
  openedBundle(capture: CaptureIdentity, bundlePath: string): void { this.workflow.openedBundle(capture, bundlePath); }

  async command(action: string, context: CommandContext): Promise<void> {
    if (this.closed) return;
    const view = this.workflow.view;
    if (context.session !== view.context.session || context.transport !== view.context.transport
      || context.attempt !== view.context.attempt || context.revision !== view.context.revision) return;
    for (const effect of this.workflow.command(action, context)) {
      if (effect.kind === 'complete') this.completion = effect;
    }
    if (action !== 'practice-finish' || !this.completion || this.finishing) return;
    const progress = this.progress;
    const completion = this.completion;
    const operation = async () => {
      if (progress.state !== 'ready' && progress.state !== 'saved') await progress.load();
      await progress.finish();
      if (this.closed || progress !== this.progress) return;
      if (progress.state === 'saved') {
        this.close();
        this.ports.finished(completion.capture, completion.bundlePath);
      }
    };
    this.finishing = operation();
    try { await this.finishing; }
    finally { if (progress === this.progress) this.finishing = null; }
  }

  close(): void {
    this.closed = true;
    this.workflow.revoke();
    this.progress.close();
  }
}
