import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { shortcutCapture } from '../../electron/onboarding/shortcut-editor.ts';

const require = createRequire(import.meta.url);
const { parseAction } = require('../../electron/onboarding-protocol.cjs') as { parseAction: (value: unknown) => unknown };

const event = (overrides: Partial<Parameters<typeof shortcutCapture>[0]> = {}) => ({key:'Unidentified',code:'LaunchAssistant',ctrlKey:false,altKey:false,metaKey:true,shiftKey:true,...overrides});
test('recognizes Copilot with Super+Shift on Linux', () => assert.deepEqual(shortcutCapture(event(), 'linux'), {keyCode:201,modifiers:768,key:'Copilot'}));
test('recognizes the unmodified Copilot key', () => assert.deepEqual(shortcutCapture(event({key:'LaunchAssistant',metaKey:false,shiftKey:false}), 'linux'), {keyCode:201,modifiers:0,key:'Copilot'}));
test('recognizes Linux keycode 201 F23/XF86Assistant aliases as Copilot', () => {
  for (const eventValue of [event({key:'\u0000',code:'F23'}), event({key:'\u0000',code:'F23',metaKey:false,shiftKey:false}), event({key:'F23',code:'F23'}), event({key:'XF86Assistant',code:'F23'}), event({key:'LaunchAssistant',code:'LaunchAssistant'})]) {
    assert.deepEqual(shortcutCapture(eventValue, 'linux'), {keyCode:201,modifiers:eventValue.metaKey?768:0,key:'Copilot'});
  }
  assert.deepEqual(shortcutCapture(event({key:'Unidentified',code:'F23'}), 'linux'), {keyCode:201,modifiers:768,key:'Copilot'});
  assert.equal(shortcutCapture(event({key:'F23',code:'F23'}), 'macos'), null, 'Linux aliases do not relax macOS');
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
