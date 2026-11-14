import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialPractice, reducePractice, stages} from '../../../electron/onboarding/practice.ts';
import type {Event, Practice, Stage} from '../../../electron/onboarding/practice.ts';
function practice(seed: Practice = initialPractice()) {
  let state = seed;
  return {
    get state() { return state; },
    stage(expected: Stage) { assert.equal(state.stage, expected); },
    send(type: Event['type'], extra: object = {}) {
      const before = structuredClone(state);
      Object.freeze(state);
      const result = reducePractice(state, {type, ...extra} as Event);
      assert.deepEqual(state, before, 'reducer cannot mutate its input');
      state = result.state;
      return result.accepted;
    },
    action(action: string) { return this.send('action', {action}); },
    ink(board: boolean, screen: number) { this.send('ink', {board, screen}); },
  };
}
function toScreenInk() {
  const p = practice(); p.send('started'); p.send('whiteboard'); p.ink(true, 0);
  p.stage('screen-ink'); return p;
}
function throughDrawing() {
  const p = toScreenInk(); p.ink(false, 0); p.ink(false, 1); p.stage('stop'); return p;
}
// One-for-one ports of ALL ten donor test cases; original names retained.
test('renderer_cannot_skip_real_capture_or_drawing', () => {
  const p = practice(); assert.equal(p.action('practice-pasted'), false); p.send('started');
  p.ink(true, 1); p.stage('whiteboard'); p.send('whiteboard'); p.ink(true, 1); p.stage('screen-ink');
  p.ink(false, 1); p.stage('screen-ink'); p.ink(false, 2); p.stage('stop');
  p.send('processing'); p.send('saved', {copied: true}); p.stage('copied');
  assert.equal(p.action('practice-finish'), false); assert(p.action('practice-paste'));
  assert(p.action('practice-pasted')); p.send('opened-latest'); p.stage('complete'); assert(p.action('practice-finish'));
});
test('owned_board_visibility_reconciles_open_and_close_without_skipping_ink', () => {
  const p = practice(); p.send('whiteboard-visible', {visible: true}); p.stage('start');
  p.send('started'); p.send('whiteboard-visible', {visible: false}); p.stage('whiteboard');
  p.send('whiteboard-visible', {visible: true}); p.stage('board-ink');
  p.send('whiteboard-visible', {visible: false}); p.stage('whiteboard');
  p.send('whiteboard-visible', {visible: true}); p.ink(true, 0); p.stage('screen-ink');
  p.send('whiteboard-visible', {visible: false}); p.stage('screen-ink');
});
test('failed_copy_and_early_stop_never_claim_copied', () => {
  let p = practice(); p.send('started'); p.send('processing'); p.send('saved', {copied: true}); p.stage('copied');
  p = throughDrawing(); p.send('processing'); p.send('saved', {copied: false}); p.stage('copy-failed');
  p = practice(); p.send('started'); p.send('cancelled'); p.stage('retry');
});
test('partial_saved_capture_still_teaches_where_the_app_lives_without_completing_practice', () => {
  const p = toScreenInk(); p.send('processing'); p.send('saved', {copied: true}); p.stage('copied');
  assert(p.action('practice-paste')); assert(p.action('practice-pasted')); p.send('opened-latest');
  p.stage('retry'); assert.equal(p.action('practice-finish'), false);
});
test('screen_is_taught_before_whiteboard_and_cancellation_cannot_complete_practice', () => {
  const p = practice(); p.send('selecting'); p.stage('screen'); p.send('processing');
  p.send('saved', {copied: true}); p.stage('screen'); p.send('whiteboard-visible', {visible: true}); p.stage('screen');
  p.send('started'); p.stage('whiteboard'); p.send('cancelled'); p.stage('retry'); assert.equal(p.action('practice-finish'), false);
});
test('failed_copy_can_find_the_saved_capture_but_cannot_claim_a_paste', () => {
  const p = throughDrawing(); p.send('processing'); p.send('saved', {copied: false}); p.stage('copy-failed');
  assert(p.action('practice-locate')); p.send('opened-latest'); p.stage('retry');
});
test('note_receipts_do_not_gate_practice_and_retry_resets_drawing', () => {
  const p = practice(); p.send('note', {saved: true}); p.stage('start'); p.send('started');
  p.send('note', {saved: true}); p.stage('whiteboard'); p.send('whiteboard'); p.ink(true, 0); p.stage('screen-ink');
  p.send('cancelled'); p.send('started'); p.send('whiteboard'); p.ink(true, 0); p.stage('screen-ink');
});
test('legacy_note_stage_resumes_at_screen_drawing_and_requires_a_fresh_stroke', () => {
  const p = practice({...initialPractice(), stage: 'note', boardInk: true, screenBaseline: 4});
  p.ink(false, 4); p.stage('screen-ink'); p.ink(false, 4); p.stage('screen-ink'); p.ink(false, 5); p.stage('stop');
});
test('late_note_receipt_at_finish_cannot_skip_required_screen_drawing', () => {
  const p = practice({...initialPractice(), stage: 'note'}); p.send('processing'); p.send('note', {saved: true});
  p.stage('preparing'); p.send('saved', {copied: true}); p.action('practice-paste'); p.action('practice-pasted');
  p.send('opened-latest'); p.stage('retry');
});
test('optional_note_receipt_does_not_change_drawing_completion', () => {
  const p = throughDrawing(); p.send('processing'); p.send('note', {saved: true}); p.stage('preparing');
  p.send('saved', {copied: true}); p.action('practice-paste'); p.action('practice-pasted'); p.send('opened-latest'); p.stage('complete');
});
// Full stage admission table protects ignored/late observations and action return values.
const transitions: Record<string, Partial<Record<Stage, Stage>>> = {
  started: {start:'whiteboard',screen:'whiteboard',retry:'whiteboard','copy-failed':'whiteboard'},
  whiteboard: {whiteboard:'board-ink'},
  processing: {whiteboard:'preparing','board-ink':'preparing',note:'preparing','screen-ink':'preparing',stop:'preparing'},
  cancelled: {screen:'retry',whiteboard:'retry','board-ink':'retry',note:'retry','screen-ink':'retry',stop:'retry',preparing:'retry'},
  saved: {preparing:'copied'},
  'practice-paste': {copied:'paste'}, 'practice-pasted': {paste:'locate'},
  'practice-locate': {'copy-failed':'locate'}, 'practice-finish': {complete:'complete'},
};
test('every stage: transition admission, invalid actions and late notes', () => {
  for (const stage of stages) {
    for (const [name, table] of Object.entries(transitions)) {
      const p = practice({...initialPractice(), stage});
      const action = name.startsWith('practice-');
      const accepted = action ? p.action(name) : p.send(name as Event['type'], {copied:true});
      p.stage(table[stage] ?? stage);
      assert.equal(accepted, action && table[stage] !== undefined, `${stage}/${name}`);
    }
    const p = practice({...initialPractice(), stage});
    const original = structuredClone(p.state);
    for (const action of ['', 'practice-started', 'practice-whiteboard', 'practice-saved', 'practice-latest', 'unknown'])
      assert.equal(p.action(action), false);
    p.send('note', {saved:false}); p.send('note', {saved:true});
    assert.deepEqual(p.state, original);
    p.send('saved', {copied:false}); p.stage(stage === 'preparing' ? 'copy-failed' : stage);
  }
});
test('selecting resets all fields except repeated screen selection; started resets only admitted stages', () => {
  for (const stage of stages) {
    const seed: Practice = {stage,boardInk:true,screenInk:true,latest:true,screenBaseline:42,pasted:true};
    const p = practice(seed); p.send('selecting');
    assert.deepEqual(p.state, stage === 'screen' ? seed : {...initialPractice(),stage:'screen'});
    const q = practice(seed); q.send('started');
    assert.deepEqual(q.state, transitions.started[stage] ? {...initialPractice(),stage:'whiteboard'} : seed);
  }
});
test('fresh screen stroke is strictly later, board observation never consumes same sample twice', () => {
  const p = practice(); p.send('started'); p.send('whiteboard'); p.ink(true, 7); p.stage('screen-ink');
  for (const count of [7, 0, 6, 7]) { p.ink(true, count); p.stage('screen-ink'); }
  p.ink(false, 8); p.stage('stop');
});
test('opened-latest only acts in locate and requires all three independent completion facts', () => {
  for (const stage of stages) for (let bits = 0; bits < 8; bits++) {
    const seed: Practice = {...initialPractice(), stage, boardInk:!!(bits&1),screenInk:!!(bits&2),pasted:!!(bits&4)};
    const p = practice(seed); p.send('opened-latest');
    assert.deepEqual(p.state, stage === 'locate' ? {...seed,latest:true,stage:bits===7?'complete':'retry'} : seed);
  }
});
test('all stages reconcile board visibility and ink snapshots, retaining unrelated fields', () => {
  for (const stage of stages) {
    for (const visible of [false,true]) {
      const p=practice({...initialPractice(),stage}); p.send('whiteboard-visible',{visible});
      p.stage(visible && stage==='whiteboard'?'board-ink':!visible && stage==='board-ink'?'whiteboard':stage);
    }
    for (const board of [false,true]) for (const screen of [0,4,5]) {
      const seed: Practice={...initialPractice(),stage,screenBaseline:4};
      const p=practice(seed); p.ink(board,screen);
      const expected=stage==='board-ink'&&board?{...seed,boardInk:true,screenBaseline:screen,stage:'screen-ink'}
        :stage==='note'?{...seed,screenBaseline:screen,stage:'screen-ink'}
        :stage==='screen-ink'&&screen>4?{...seed,screenInk:true,stage:'stop'}:seed;
      assert.deepEqual(p.state,expected);
    }
  }
});
