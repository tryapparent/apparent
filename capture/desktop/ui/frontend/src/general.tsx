import {useEffect, useState} from 'react';
import {NativeSelect} from '@apparent/ui/native-select';
import {Button} from '@apparent/ui/button';
import {generalNamedShortcut} from '../electron/settings/general';
import {ConnectSettingsCard} from './connect/card';
import {OptionShortcutGesture, shortcutCapture, shortcutInput} from '../electron/onboarding/shortcut-editor';

type Shortcut = {kind:'record'|'paste';title:string;label:string;recording:boolean;externallyManaged:boolean;isDefault:boolean;clearable:boolean;error:string|null};
type GeneralState = {platform:'linux'|'macos';login:{on:boolean;available:boolean;needsApproval:boolean};shortcuts:Shortcut[];errorReporting:boolean;lowerPlayback:boolean;playbackLevel:number;playbackAvailable:boolean};
declare global {interface Window {apparentGeneral?:{read():Promise<GeneralState|undefined>;act(action:unknown):Promise<void>;subscribe(callback:(state:GeneralState)=>void):()=>void}}}

export function General() {
  const [state,setState]=useState<GeneralState>(),[error,setError]=useState('');
  useEffect(()=>{
    let active=true,received=false;
    const bridge=window.apparentGeneral;
    const unsubscribe=bridge?.subscribe(next=>{received=true;setState(next)});
    void bridge?.read().then(next=>{if(active&&!received)setState(next)}).catch(()=>{if(active)setError('Settings unavailable. Close and reopen Settings to retry.')});
    return()=>{active=false;unsubscribe?.()};
  },[]);
  async function act(action:unknown){try{setError('');await window.apparentGeneral?.act(action)}catch{setError('The setting could not be sent. Close and reopen Settings to retry.')}}
  const recording=state?.shortcuts.find(s=>s.recording);
  useEffect(()=>{
    if(!recording||!state)return;
    const gesture=new OptionShortcutGesture();
    const blur=()=>{gesture.reset();void act({action:'cancel-shortcut'})};
    const pointerDown=()=>gesture.pointer(true),pointerUp=()=>gesture.pointer(false);
    const release=(event:KeyboardEvent)=>{
      const captured=gesture.up(event);
      if(captured&&recording.kind==='record')void act({action:'shortcut',kind:recording.kind,...captured,reserved:false});
    };
    const key=(event:KeyboardEvent)=>{
      event.preventDefault();event.stopPropagation();
      gesture.down(event,state.platform);
      if(event.repeat){gesture.cancel();return}
      if(event.key==='Escape'){blur();return}
      if(recording.clearable&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey&&['Backspace','Delete'].includes(event.key)){void act({action:'clear-shortcut',kind:recording.kind});return}
      if(shortcutInput(event,state.platform)!=='key')return;
      const captured=generalNamedShortcut(event,state.platform)??shortcutCapture(event,state.platform);
      if(captured)void act({action:'shortcut',kind:recording.kind,...captured,reserved:false});
      else setError('Use a letter, number, function or named key, or choose Fn on macOS. Escape cancels.');
    };
    window.addEventListener('keydown',key,true);window.addEventListener('keyup',release,true);window.addEventListener('blur',blur);
    window.addEventListener('pointerdown',pointerDown,true);window.addEventListener('pointerup',pointerUp,true);window.addEventListener('pointercancel',pointerUp,true);
    return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('keyup',release,true);window.removeEventListener('blur',blur);
      window.removeEventListener('pointerdown',pointerDown,true);window.removeEventListener('pointerup',pointerUp,true);window.removeEventListener('pointercancel',pointerUp,true)};
  },[recording,state?.platform]);
  function toggle(label:string,key:string,on:boolean,available=true){return <label className="general-row"><span>{label}</span><input type="checkbox" checked={on} disabled={!available} onChange={e=>void act({action:'set',key,value:e.target.checked})}/></label>}
  return <div className="general-settings">
    <ConnectSettingsCard />
    {error&&<p role="alert">{error}</p>}
    {!state?<p role="status">Reading General settings…</p>:<>
      {toggle('Launch at login','launchAtLogin',state.login.on,state.login.available)}
      {state.login.needsApproval&&<p className="settings-metadata">Allow Apparent in your system’s startup settings.</p>}
      {!state.login.available&&<p className="settings-metadata">Launch at login requires an installed app.</p>}
      {state.shortcuts.map(s=><section key={s.kind} className="general-shortcut" aria-label={s.title}>
        <h2>{s.title}</h2><div className="settings-actions">
          <Button variant="outline" disabled={s.externallyManaged} onClick={()=>void act({action:s.recording?'cancel-shortcut':'record-shortcut',...(s.recording?{}:{kind:s.kind})})}>{s.recording?'Press shortcut… (Esc cancels)':s.label||'Set shortcut'}</Button>
          {!s.isDefault&&!s.recording&&!s.externallyManaged&&<Button variant="ghost" onClick={()=>void act({action:'reset-shortcut',kind:s.kind})}>Reset</Button>}
          {s.clearable&&s.label&&!s.recording&&!s.externallyManaged&&<Button variant="ghost" onClick={()=>void act({action:'clear-shortcut',kind:s.kind})}>Turn off</Button>}
          {s.recording&&state.platform==='macos'&&<Button variant="outline" onClick={()=>void act({action:'shortcut',kind:s.kind,keyCode:63,modifiers:0,key:'Fn',reserved:false})}>Use Fn</Button>}
        </div>
        <p className="settings-metadata">{s.error|| (s.externallyManaged?'Managed by your desktop’s shortcut settings.':s.kind==='paste'?'Pastes the last capture into the app in front.':'Records the screen. Press again to finish.')}</p>
      </section>)}
      {toggle('Send technical error reports','errorReporting',state.errorReporting)}
      <p className="settings-metadata">No recordings, screenshots, transcripts or clipboard contents are sent.</p>
      <h2 className="general-shortcut">Other audio</h2>
      {toggle('Lower other audio while recording','lowerPlayback',state.lowerPlayback,state.playbackAvailable||state.lowerPlayback)}
      <label className="general-row">Lower to<NativeSelect aria-label="Lower to" disabled={!state.lowerPlayback||!state.playbackAvailable} value={state.playbackLevel} onChange={e=>void act({action:'set',key:'playbackLevel',value:Number(e.target.value)})}>{[0,10,20,35,50,75,100].map(n=><option key={n} value={n}>{n}%</option>)}</NativeSelect></label>
      <p className="settings-metadata">{state.platform==='linux'?'Experimental on Linux; requires manual setup. No live effectiveness check.':'Temporarily lower other audio while recording.'}</p>
    </>}
  </div>;
}
