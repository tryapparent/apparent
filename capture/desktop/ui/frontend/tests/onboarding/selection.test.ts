import {test} from 'node:test';
import assert from 'node:assert/strict';
import {completedSelection} from '../../electron/onboarding/selection.ts';

const selected = {step:'shortcut',firstCaptureRequired:true,shortcut:'Fn',shortcutChosen:true,
  shortcutTested:false,shortcutEditing:false,shortcutSelectionReleased:true,shortcutEditor:{recording:false}};
test('the accepted and released selection counts as the first practice',()=>{
  for(const shortcut of ['Fn','Copilot','⌥S','Ctrl+Shift+S'])
    assert.equal(completedSelection({...selected,shortcut}),`accept-shortcut-choice:${shortcut}`);
});
test('held, unfinished, changed or already accepted choices never complete another practice',()=>{
  for(const patch of [{shortcutSelectionReleased:false},{shortcutChosen:false},{shortcutTested:true},
    {shortcutEditing:true},{shortcutEditor:{recording:true}},{step:'welcome'},{step:'try-it'},
    {firstCaptureRequired:false},{shortcut:''}]) assert.equal(completedSelection({...selected,...patch}),null);
});
