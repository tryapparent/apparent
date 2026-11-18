export type ShortcutKeyEvent = {
  key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean;
};

export type ShortcutCapture = { keyCode: number; modifiers: number; key: string };

// A standalone modifier is selected on release, after an uninterrupted gesture.
// Track physical keys so releasing another modifier cannot turn a chord into Option.
export class OptionShortcutGesture {
  private held = new Set<string>();
  private candidate: string | null = null;
  private pointerHeld = false;
  reset() { this.held.clear(); this.candidate = null; this.pointerHeld = false; }
  cancel() { this.candidate = null; }
  pointer(down: boolean) { this.pointerHeld = down; this.cancel(); }
  down(event: ShortcutKeyEvent, platform: 'macos'|'linux') {
    const clean = this.held.size === 0;
    this.held.add(event.code || event.key);
    this.candidate = platform === 'macos' && clean && !this.pointerHeld && event.key === 'Alt' &&
      !event.ctrlKey && !event.metaKey && !event.shiftKey ? event.code : null;
  }
  up(event: ShortcutKeyEvent): ShortcutCapture | null {
    const select = this.candidate !== null && this.candidate === event.code &&
      event.key === 'Alt' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    this.held.delete(event.code || event.key);
    this.candidate = null;
    return select ? {keyCode:58,modifiers:0,key:'Option'} : null;
  }
}

export function desktopShortcutSelection(state: {platform:string;step:string;shortcutEditor?:{recording:boolean}|null}|null, value: unknown) {
  if(state?.platform!=='linux'||state.step!=='shortcut'||!state.shortcutEditor?.recording)return null;
  if(!value||typeof value!=='object')return null;
  const v=value as ShortcutCapture;
  if(v.keyCode!==201||v.key!=='Copilot'||!Number.isInteger(v.modifiers)||(v.modifiers&~6912)!==0)return null;
  return {action:'shortcut' as const,kind:'record' as const,keyCode:v.keyCode,modifiers:v.modifiers,key:v.key,reserved:false as const};
}

// Modifier keydowns are intermediate input, not invalid shortcuts. In particular,
// do not end listening before a person has pressed the chord's final key.
export function shortcutInput(event: ShortcutKeyEvent, platform: 'macos'|'linux') {
  if (['Control','Shift','Alt','Meta','AltGraph'].includes(event.key)) return 'pending';
  if (platform === 'linux' && (event.key === 'Fn' || event.code === 'Fn')) return 'fn-unavailable';
  // Chromium loses both identities for XF86Assistant on the X1 keymap. Ask the
  // native adapter to confirm the held physical key; never infer it from null.
  if (platform === 'linux' && event.key === '\u0000' && !event.code) return 'native-copilot';
  return 'key';
}

function macFnKey(): ShortcutCapture {
  return { keyCode: 63, modifiers: 0, key: 'Fn' };
}

export function suggestedFnChoice(platform: 'macos'|'linux'|undefined, projected: ShortcutCapture | null | undefined) {
  return platform === 'macos' && projected === undefined ? macFnKey() : projected;
}

export function fnSelectionActions(choice: ShortcutCapture | null | undefined, recording: boolean): Array<'change-shortcut' | ({action:'shortcut';kind:'record';reserved:false} & ShortcutCapture)> {
  if(!choice)return [];
  const select={action:'shortcut' as const,kind:'record' as const,...choice,reserved:false as const};
  return recording ? [select] : ['change-shortcut',select];
}

const macCodes: Record<string, number> = { a:0,s:1,d:2,f:3,h:4,g:5,z:6,x:7,c:8,v:9,b:11,q:12,w:13,e:14,r:15,y:16,t:17,'1':18,'2':19,'3':20,'4':21,'6':22,'5':23,'9':25,'7':26,'8':28,'0':29,o:31,u:32,i:34,p:35,l:37,j:38,k:40,n:45,m:46 };

export function shortcutCapture(event: ShortcutKeyEvent, platform: 'macos'|'linux'): ShortcutCapture | null {
  // The observed X1 sends KEY_WAKEUP for standalone Fn. X11 cannot
  // distinguish that physical Fn key from a dedicated WakeUp key.
  if(platform==='linux'&&['WakeUp','XF86WakeUp'].includes(event.key)&&
      !event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey){
    return {keyCode:95,modifiers:0,key:'Fn'};
  }
  if (platform === 'macos' && (event.key === 'Fn' || event.code === 'Fn') &&
      !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
    return macFnKey();
  }
  // On the supported Linux image, evdev KEY_F23 (193) becomes XKB keycode 201,
  // whose keymap symbols include F23 and XF86Assistant. Electron may report the
  // F23 identity even though it is the Copilot physical key on this layout.
  const copilot = platform === 'linux' && (event.key === 'Copilot' || event.key === 'LaunchAssistant' || event.key === 'XF86Assistant' || event.key === 'F23' || event.key === '\u0000' && event.code === 'F23' || event.code === 'LaunchAssistant' || event.code === 'XF86Assistant' || event.code === 'Copilot' || event.code === 'F23');
  if (copilot) {
    return { keyCode: 201, modifiers:(event.metaKey?256:0)|(event.shiftKey?512:0)|(event.altKey?2048:0)|(event.ctrlKey?4096:0), key: 'Copilot' };
  }
  const physical = /^(Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(Key|Digit)/, '').toLowerCase() : event.key.toLowerCase();
  const key = platform === 'macos' ? physical : event.key.toLowerCase();
  if (!/^[a-z0-9]$/.test(key)) return null;
  return { keyCode: platform === 'macos' ? macCodes[key] : key.toUpperCase().charCodeAt(0), modifiers:(event.metaKey?256:0)|(event.shiftKey?512:0)|(event.altKey?2048:0)|(event.ctrlKey?4096:0), key };
}
