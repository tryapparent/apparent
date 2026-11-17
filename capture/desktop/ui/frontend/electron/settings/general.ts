// The parent owns effects and persistence. Admit only General's bounded actions.
export function validAction(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v).sort().join(',');
  if (v.action === 'set' && keys === 'action,key,value') {
    return ['launchAtLogin','errorReporting','lowerPlayback'].includes(String(v.key)) && typeof v.value === 'boolean'
      || v.key === 'playbackLevel' && Number.isInteger(v.value) && Number(v.value) >= 0 && Number(v.value) <= 100;
  }
  if (v.action === 'cancel-shortcut') return keys === 'action';
  const kind = v.kind === 'record' || v.kind === 'paste';
  if (['record-shortcut','reset-shortcut','clear-shortcut'].includes(String(v.action))) return kind && keys === 'action,kind';
  if(v.key === 'Option')return v.action === 'shortcut' && v.kind === 'record' && keys === 'action,key,keyCode,kind,modifiers,reserved'
    && (v.keyCode === 58 || v.keyCode === 61) && v.modifiers === 0 && v.reserved === false;
  return v.action === 'shortcut' && kind && keys === 'action,key,keyCode,kind,modifiers,reserved'
    && Number.isInteger(v.keyCode) && Number(v.keyCode) >= 0 && Number(v.keyCode) <= 255
    && Number.isInteger(v.modifiers) && (Number(v.modifiers) & ~6912) === 0
    && typeof v.key === 'string' && /^[a-z0-9]$|^(Fn|Copilot|F([1-9]|1[0-6])|Space|Enter|Tab|Backspace|Delete|Arrow(Left|Right|Up|Down))$/.test(v.key) && v.reserved === false;
}

// Match the native provider's F1–F16 and named-key codes. Native validation and
// registration still decide whether the OS or another shortcut owns a chord.
export function generalNamedShortcut(event: {key:string;ctrlKey:boolean;altKey:boolean;metaKey:boolean;shiftKey:boolean}, platform:'linux'|'macos') {
  const functionNumber = /^F([1-9]|1[0-6])$/.exec(event.key);
  const macFunctions = [122,120,99,118,96,97,98,100,101,109,103,111,105,107,113,106];
  const named: Record<string,[number,number]> = {' ':[32,49],Enter:[13,36],Tab:[9,48],Backspace:[8,51],Delete:[46,117],ArrowLeft:[37,123],ArrowRight:[39,124],ArrowDown:[40,125],ArrowUp:[38,126]};
  const keyCode = functionNumber ? platform==='macos' ? macFunctions[Number(functionNumber[1])-1] : 111+Number(functionNumber[1])
    : named[event.key]?.[platform==='macos'?1:0];
  if(keyCode===undefined)return null;
  return {keyCode,key:event.key===' '?'Space':event.key,modifiers:(event.metaKey?256:0)|(event.shiftKey?512:0)|(event.altKey?2048:0)|(event.ctrlKey?4096:0)};
}
