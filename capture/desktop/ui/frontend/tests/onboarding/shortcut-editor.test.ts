import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shortcutCapture } from '../../electron/onboarding/shortcut-editor.ts';

const require = createRequire(import.meta.url);
const { parseAction } = require('../../electron/onboarding-protocol.cjs') as { parseAction: (value: unknown) => unknown };

const event = (overrides: Partial<Parameters<typeof shortcutCapture>[0]> = {}) => ({key:'Unidentified',code:'LaunchAssistant',ctrlKey:false,altKey:false,metaKey:true,shiftKey:true,...overrides});
test('recognizes Copilot with Super+Shift on Linux', () => assert.deepEqual(shortcutCapture(event(), 'linux'), {keyCode:201,modifiers:768,key:'Copilot'}));
test('recognizes the unmodified Copilot key', () => assert.deepEqual(shortcutCapture(event({key:'LaunchAssistant',metaKey:false,shiftKey:false}), 'linux'), {keyCode:201,modifiers:0,key:'Copilot'}));
test('recognizes keycode 201 only from the observed NUL/F23 X11 event', () => {
  for (const eventValue of [event({key:'\u0000',code:'F23'}), event({key:'\u0000',code:'F23',metaKey:false,shiftKey:false})]) {
    assert.deepEqual(shortcutCapture(eventValue, 'linux'), {keyCode:201,modifiers:eventValue.metaKey?768:0,key:'Copilot'});
  }
  assert.equal(shortcutCapture(event({key:'F23',code:'F23'}), 'linux'), null, 'a genuine F23 keeps its function-key identity');
  assert.equal(shortcutCapture(event({key:'Unidentified',code:'F23'}), 'linux'), null);
});
test('rejects partial Super or Shift modifiers on Copilot', () => {
  assert.equal(shortcutCapture(event({metaKey:true,shiftKey:false}), 'linux'), null);
  assert.equal(shortcutCapture(event({metaKey:false,shiftKey:true}), 'linux'), null);
});
test('does not relax the modifier rule for ordinary keys', () => assert.equal(shortcutCapture(event({key:'r',code:'KeyR',metaKey:false,shiftKey:false}), 'linux'), null));
test('retains ordinary Linux shortcut encoding', () => assert.deepEqual(shortcutCapture(event({key:'r',code:'KeyR',shiftKey:false}), 'linux'), {keyCode:82,modifiers:256,key:'r'}));
test('the Electron parent accepts only the two Copilot chords', () => {
  for (const modifiers of [0,768]) assert.deepEqual(parseAction({action:'shortcut',kind:'record',keyCode:201,modifiers,key:'Copilot',reserved:false}), {action:'shortcut',kind:'record',keyCode:201,modifiers,key:'Copilot',reserved:false});
  for (const modifiers of [256,512,769]) assert.throws(() => parseAction({action:'shortcut',kind:'record',keyCode:201,modifiers,key:'Copilot',reserved:false}));
  assert.throws(() => parseAction({action:'shortcut',kind:'record',keyCode:65,modifiers:0,key:'A',reserved:false}));
});
