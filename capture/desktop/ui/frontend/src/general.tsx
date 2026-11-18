import {generalNamedShortcut} from '../electron/settings/general';
import {OptionShortcutGesture, shortcutCapture, shortcutInput} from '../electron/onboarding/shortcut-editor';

type InputState = {platform: 'linux' | 'macos'; shortcuts: {kind: 'record' | 'paste'; recording: boolean; clearable: boolean}[]};

function bindShortcutInput(root: HTMLDivElement, read: () => InputState | undefined, act: (action: Record<string, unknown>) => Promise<void>, setValidation: (message: string) => void) {
    const gesture=new OptionShortcutGesture();
    const blocked=(event:KeyboardEvent)=>root.querySelector('dialog[open]')!==null||event.target instanceof Element&&(event.target.closest('dialog[open]')||event.target.closest('.apparent-disclosure')?.querySelector('.disclosure-panel'));
    const suggestion=(event:KeyboardEvent)=>event.target instanceof Element&&event.target.closest('[data-shortcut-suggestion]');
    const blur=()=>{gesture.reset();if(read()?.shortcuts.some(s=>s.recording))void act({action:'cancel-shortcut'})};
    const pointerDown=()=>gesture.pointer(true),pointerUp=()=>gesture.pointer(false);
    const wheel=()=>gesture.cancel();
    const release=(event:KeyboardEvent)=>{
      const recording=read()?.shortcuts.find(s=>s.recording);
      if(!recording||blocked(event)){gesture.reset();return}
      const captured=gesture.up(event);
      if(!suggestion(event)&&captured&&recording.kind==='record')void act({action:'shortcut',kind:recording.kind,...captured,reserved:false});
    };
    const key=(event:KeyboardEvent)=>{
      const state=read();
      const recording=state?.shortcuts.find(s=>s.recording);
      if(!state||!recording||blocked(event)){gesture.reset();return}
      gesture.down(event,state.platform);
      if(suggestion(event)&&event.key!=='Escape'){gesture.cancel();return}

      event.preventDefault();event.stopPropagation();
      if(event.repeat){gesture.cancel();return}
      if(event.key==='Escape'){blur();return}
      if(recording.clearable&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey&&['Backspace','Delete'].includes(event.key)){void act({action:'clear-shortcut',kind:recording.kind});return}
      if(shortcutInput(event,state.platform)!=='key')return;
      const captured=generalNamedShortcut(event,state.platform)??shortcutCapture(event,state.platform);
      if(captured)void act({action:'shortcut',kind:recording.kind,...captured,reserved:false});
      else setValidation('Use a letter, number, function or named key, or choose Fn on macOS. Escape cancels.');
    };
    window.addEventListener('keydown',key,true);window.addEventListener('keyup',release,true);window.addEventListener('blur',blur);
    window.addEventListener('pointerdown',pointerDown,true);window.addEventListener('pointerup',pointerUp,true);window.addEventListener('pointercancel',pointerUp,true);
    window.addEventListener('wheel',wheel,{capture:true,passive:true});
    return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',release,true);window.removeEventListener('blur',blur);
      window.removeEventListener('pointerdown',pointerDown,true);window.removeEventListener('pointerup',pointerUp,true);window.removeEventListener('pointercancel',pointerUp,true);window.removeEventListener('wheel',wheel,true)};
  }

Object.defineProperty(window, 'apparentSettingsShortcutInput', {value: Object.freeze({bindShortcutInput})});

export { ConnectSettingsCard } from "./connect/card";
