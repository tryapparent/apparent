import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { desktopShortcutSelection, fnSelectionActions, fnShortcut, shortcutCapture, shortcutInput } from '../../electron/onboarding/shortcut-editor.ts';

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
test('accepts Copilot with every supported modifier combination', () => {
  for(let mask=0;mask<16;mask++){
    const e=event({ctrlKey:!!(mask&1),altKey:!!(mask&2),metaKey:!!(mask&4),shiftKey:!!(mask&8)});
    const capture=shortcutCapture(e,'linux');
    assert.deepEqual(capture,{keyCode:201,modifiers:(mask&1?4096:0)|(mask&2?2048:0)|(mask&4?256:0)|(mask&8?512:0),key:'Copilot'});
    const action={action:'shortcut',kind:'record',...capture,reserved:false};
    assert.deepEqual(parseAction(action),action);
  }
});
test('waits for modifiers and requires native confirmation of the X1 null event', () => {
  for(const platform of ['linux','macos'] as const){
    for(const key of ['Control','Shift','Alt','Meta','AltGraph'])assert.equal(shortcutInput(event({key}),platform),'pending');
  }
  const unknown=event({key:'\u0000',code:''});
  assert.equal(shortcutInput(unknown,'linux'),'native-copilot');
  assert.equal(shortcutCapture(unknown,'linux'),null,'null is never assumed to mean Copilot');
  assert.equal(shortcutInput(unknown,'macos'),'key');
  assert.deepEqual(parseAction('resolve-copilot'),{action:'resolve-copilot'});
  assert.equal(shortcutInput(event({key:'Fn',code:'Fn'}),'linux'),'fn-unavailable');
});
test('accepts an explicitly selected single ordinary key', () => {
  assert.deepEqual(shortcutCapture(event({key:'r',code:'KeyR',metaKey:false,shiftKey:false}), 'linux'), {keyCode:82,modifiers:0,key:'r'});
  assert.deepEqual(shortcutCapture(event({key:'r',code:'KeyR',metaKey:false,shiftKey:false}), 'macos'), {keyCode:15,modifiers:0,key:'r'});
});
test('X1 standalone Fn uses the observed Linux WakeUp identity',()=>{
  for(const key of ['WakeUp','XF86WakeUp']){
    const e=event({key,code:'',metaKey:false,shiftKey:false});
    const capture=shortcutCapture(e,'linux');
    assert.deepEqual(capture,{keyCode:95,modifiers:0,key:'Fn'});
    const action={action:'shortcut',kind:'record',...capture,reserved:false};
    assert.deepEqual(parseAction(action),action);
    assert.equal(shortcutCapture({...e,ctrlKey:true},'linux'),null);
    assert.equal(shortcutCapture(e,'macos'),null);
  }
});
test('a compositor-consumed Copilot callback selects only in a current Linux recorder',()=>{
  const value={keyCode:201,modifiers:768,key:'Copilot'};
  const state={platform:'linux',step:'shortcut',shortcutEditor:{recording:true}};
  assert.deepEqual(desktopShortcutSelection(state,value),{action:'shortcut',kind:'record',...value,reserved:false});
  for(const altered of [null,{...state,platform:'macos'},{...state,step:'try-it'},{...state,shortcutEditor:{recording:false}}])assert.equal(desktopShortcutSelection(altered,value),null);
  for(const invalid of [null,{...value,modifiers:1},{...value,keyCode:63},{...value,key:'Fn'}])assert.equal(desktopShortcutSelection(state,invalid),null);
});
test('accepts standalone Fn on Mac and rejects Fn with other modifiers', () => {
  assert.deepEqual(shortcutCapture(event({key:'Fn',code:'Fn',metaKey:false,shiftKey:false}), 'macos'), {keyCode:63,modifiers:0,key:'Fn'});
  assert.equal(shortcutCapture(event({key:'Fn',code:'Fn',metaKey:true,shiftKey:false}), 'macos'), null);
  assert.equal(shortcutCapture(event({key:'Fn',code:'Fn',metaKey:false,shiftKey:false}), 'linux'), null);
});
test('retains ordinary Linux shortcut encoding', () => assert.deepEqual(shortcutCapture(event({key:'r',code:'KeyR',shiftKey:false}), 'linux'), {keyCode:82,modifiers:256,key:'r'}));
test('the Electron parent accepts supported keys and rejects malformed modifier bits', () => {
  assert.deepEqual(parseAction({action:'shortcut',kind:'record',keyCode:63,modifiers:0,key:'Fn',reserved:false}), {action:'shortcut',kind:'record',keyCode:63,modifiers:0,key:'Fn',reserved:false});
  assert.deepEqual(parseAction({action:'shortcut',kind:'record',keyCode:65,modifiers:0,key:'a',reserved:false}), {action:'shortcut',kind:'record',keyCode:65,modifiers:0,key:'a',reserved:false});
  for (const modifiers of [0,768]) assert.deepEqual(parseAction({action:'shortcut',kind:'record',keyCode:201,modifiers,key:'Copilot',reserved:false}), {action:'shortcut',kind:'record',keyCode:201,modifiers,key:'Copilot',reserved:false});
  for (const modifiers of [1,769,8192,-1]) assert.throws(() => parseAction({action:'shortcut',kind:'record',keyCode:201,modifiers,key:'Copilot',reserved:false}));
  assert.throws(() => parseAction({action:'shortcut',kind:'record',keyCode:65,modifiers:0,key:'A',reserved:false}));
});

test('explicit Fn selection is Mac-only and uses the accepted provider contract', () => {
  assert.equal(fnShortcut('linux'), null);
  const choice=fnShortcut('macos');
  assert.deepEqual(choice, {keyCode:63,modifiers:0,key:'Fn'});
  const action={action:'shortcut',kind:'record',...choice,reserved:false};
  assert.deepEqual(parseAction(action), action);
});

test('Fn selection enters the provider editor before choosing and keeps its guard', () => {
  const selection={action:'shortcut',kind:'record',keyCode:63,modifiers:0,key:'Fn',reserved:false};
  assert.deepEqual(fnSelectionActions('macos',false), ['change-shortcut',selection]);
  assert.deepEqual(fnSelectionActions('macos',true), [selection]);
  assert.deepEqual(fnSelectionActions('linux',false), []);
  for(const action of fnSelectionActions('macos',false))assert.deepEqual(parseAction(action),typeof action==='string'?{action}:action);
});
