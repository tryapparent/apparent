export type ShortcutKeyEvent = {
  key: string; code: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean;
};

export type ShortcutCapture = { keyCode: number; modifiers: number; key: string };

const macCodes: Record<string, number> = { a:0,s:1,d:2,f:3,h:4,g:5,z:6,x:7,c:8,v:9,b:11,q:12,w:13,e:14,r:15,y:16,t:17,'1':18,'2':19,'3':20,'4':21,'6':22,'5':23,'9':25,'7':26,'8':28,'0':29,o:31,u:32,i:34,p:35,l:37,j:38,k:40,n:45,m:46 };

export function shortcutCapture(event: ShortcutKeyEvent, platform: 'macos'|'linux'): ShortcutCapture | null {
  // On the supported Linux image, evdev KEY_F23 (193) becomes XKB keycode 201,
  // whose keymap symbols include F23 and XF86Assistant. Electron may report the
  // F23 identity even though it is the Copilot physical key on this layout.
  const copilot = platform === 'linux' && (event.key === 'Copilot' || event.key === 'LaunchAssistant' || event.key === 'XF86Assistant' || event.key === 'F23' || event.key === '\u0000' && event.code === 'F23' || event.code === 'LaunchAssistant' || event.code === 'XF86Assistant' || event.code === 'Copilot' || event.code === 'F23');
  if (copilot && !event.ctrlKey && !event.altKey &&
      ((!event.metaKey && !event.shiftKey) || (event.metaKey && event.shiftKey))) {
    return { keyCode: 201, modifiers: event.metaKey ? 768 : 0, key: 'Copilot' };
  }
  const physical = /^(Key[A-Z]|Digit[0-9])$/.test(event.code) ? event.code.replace(/^(Key|Digit)/, '').toLowerCase() : event.key.toLowerCase();
  const key = platform === 'macos' ? physical : event.key.toLowerCase();
  if (!/^[a-z0-9]$/.test(key) || !(event.ctrlKey || event.altKey || event.metaKey)) return null;
  return { keyCode: platform === 'macos' ? macCodes[key] : key.toUpperCase().charCodeAt(0), modifiers:(event.metaKey?256:0)|(event.shiftKey?512:0)|(event.altKey?2048:0)|(event.ctrlKey?4096:0), key };
}
