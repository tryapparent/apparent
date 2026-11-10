import type { NativePractice } from '../../../../../../onboarding/src/host.ts';
import type { Stage } from '../../../../../../onboarding/src/practice.ts';

/** Synthetic parent for presentation tests. The real workflow must consume every
 * observation; paste steps still require the renderer's human command path. */
export class PracticeFixture {
  private attempt = 0;
  facts: NativePractice = { version: 2, scope: { session: 'fixture', transport: '1' }, attempt: '0', observation: null, completion: null, openedBundle: null };

  async enter(stage: Stage | null, emit: (facts: NativePractice) => void, command: (action: string) => Promise<void>): Promise<void> {
    const attempt = String(++this.attempt), capture = { generation: attempt, captureId: attempt, requestId: attempt };
    this.facts = { ...this.facts, attempt, observation: null, completion: null, openedBundle: null };
    emit(this.facts);
    if (stage === null || stage === 'start') return;
    this.facts.observation = { attempt, sequence: 1, capture: null, phase: 'selecting', boardVisible: false, boardPoints: 0, screenInk: {total:0,recent:[]}, noteSaved: false };
    emit(this.facts);
    if (stage === 'screen') return;
    this.facts.observation = { ...this.facts.observation, sequence: 2, capture, phase: 'recording' }; emit(this.facts);
    if (stage === 'whiteboard') return;
    this.facts.observation = { ...this.facts.observation, sequence: 3, boardVisible: true }; emit(this.facts);
    if (stage === 'board-ink') return;
    this.facts.observation = { ...this.facts.observation, sequence: 4, boardPoints: 4 }; emit(this.facts);
    if (stage === 'note') return;
    this.facts.observation = { ...this.facts.observation, sequence: 5, boardVisible: false, noteSaved: true }; emit(this.facts);
    if (stage === 'screen-ink') return;
    this.facts.observation = { ...this.facts.observation, sequence: 6, screenInk: {total:1,recent:[{index:1,points:10,laser:false}]} }; emit(this.facts);
    if (stage === 'stop') return;
    this.facts.observation = { ...this.facts.observation, sequence: 7, phase: stage === 'retry' ? 'cancelled' : 'processing' }; emit(this.facts);
    if (stage === 'preparing' || stage === 'retry') return;
    this.facts.completion = { capture, outcome: { kind: 'saved', bundlePath: '/synthetic.apparent' }, clipboard: stage === 'copy-failed' ? 'failed' : 'copied', current: true }; emit(this.facts);
    if (stage === 'copied' || stage === 'copy-failed') return;
    await command('practice-paste');
    if (stage === 'paste') return;
    await command('practice-pasted');
    if (stage === 'locate') return;
    this.facts.openedBundle = { sequence: 1, bundlePath: '/synthetic.apparent' }; emit(this.facts);
  }
}
