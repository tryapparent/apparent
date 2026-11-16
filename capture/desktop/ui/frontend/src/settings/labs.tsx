import {T3Settings} from './t3';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@apparent/ui/button';
import {Switch} from '@apparent/ui/switch';
import {ErrorDialog} from '@apparent/ui/error-dialog';
import frog from '../../../../assets/settings/frog-puzzled.png';

type LabsSetting = 'autoPaste'|'sharing'|'wisprFlow';
export type LabsFacts = {saved:boolean|null;supported:boolean;sharingSaved:boolean|null;wisprSaved:boolean|null;wisprSupported:boolean;error?:never}|{error:'config_read_failed'|'config_write_failed';saved?:never;supported?:never;sharingSaved?:never;wisprSaved?:never;wisprSupported?:never};
declare global {interface Window {apparentLabs:{read():Promise<LabsFacts>;save(enabled:boolean,setting?:LabsSetting):Promise<LabsFacts>;subscribe(callback:(facts:LabsFacts)=>void):()=>void}}}

export function Labs(){
  const [facts,setFacts]=useState<LabsFacts>(),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const [setting,setSetting]=useState<LabsSetting>('autoPaste'),[operation,setOperation]=useState<'read'|'save'>('read');
  const live=useRef(true),pending=useRef(false),restoreFocus=useRef<string|null>(null);
  async function request(enabled?:boolean,setting:LabsSetting='autoPaste'){
    if(pending.current)return;
    if(enabled!==undefined){
      const active=document.activeElement;
      restoreFocus.current=active?.matches('.settings-labs button[role="switch"]:focus-visible')?active.id:null;
    }
    pending.current=true;setBusy(true);setSetting(setting);setOperation(enabled===undefined?'read':'save');
    try{
      const result=await(enabled===undefined?window.apparentLabs.read():window.apparentLabs.save(enabled,setting));
      if(!live.current)return;
      setFacts(result);
      setError(result.error?'Refresh the saved value, then try again.':'');
    }catch{if(live.current){setFacts(undefined);setError('The app did not confirm this preference. Refresh to check the saved value.');}}
    finally{pending.current=false;if(live.current)setBusy(false);}
  }
  useEffect(()=>{
    live.current=true;
    const unsubscribe=window.apparentLabs.subscribe(value=>{if(live.current&&!pending.current){setFacts(value);setError(value.error?'Unable to read this experiment. Refresh to try again.':'');}});
    void request();return()=>{live.current=false;unsubscribe();};
  },[]);
  useEffect(()=>{
    if(busy||!restoreFocus.current)return;
    const target=document.getElementById(restoreFocus.current) as HTMLButtonElement|null;
    restoreFocus.current=null;
    // Temporarily disabling a saving switch removes keyboard focus. Restore it
    // after acknowledgement, unless the person moved to another control/window.
    if(!facts?.error&&target&&!target.disabled&&document.hasFocus()&&document.activeElement===document.body)
      target.focus({preventScroll:true});
  },[busy,facts]);
  return <section className="settings-labs" aria-label="Experiments">
    <T3Settings />
    <section className="agent-preference">
    <div className="agent-preference-row">
      <h2 className="settings-preference-label" id="auto-paste-label">Auto paste</h2>
    <Switch id="auto-paste-toggle" className="agent-switch" checked={facts?.saved??false} aria-labelledby="auto-paste-label" aria-describedby="auto-paste-help auto-paste-limits" aria-busy={busy&&setting==='autoPaste'}
      disabled={busy||!facts||Boolean(facts.error)||!facts.supported} onCheckedChange={value=>void request(value)} /></div>
    <p id="auto-paste-help">Paste the image and text into your focused composer after recording. Off by default; applies to the next recording.</p>
    <p id="auto-paste-limits">Linux with Hyprland only. Keep your composer focused until processing finishes. Check the paste before sending; Apparent never presses Enter.</p>
    </section>
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="public-sharing-label">Public sharing links</h2>
      <Switch id="public-sharing-toggle" className="agent-switch" checked={facts?.sharingSaved??false} aria-labelledby="public-sharing-label" aria-describedby="public-sharing-help public-sharing-limits" aria-busy={busy&&setting==='sharing'}
        disabled={busy||!facts||Boolean(facts.error)} onCheckedChange={value=>void request(value,'sharing')} /></div>
      <p id="public-sharing-help">Show Copy link after recording. Off by default; applies to the next recording.</p>
      <p id="public-sharing-limits">Anyone with the link can view the shared capture. Shared captures are not end-to-end encrypted.</p>
    </section>
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 id="wispr-lab-label">Wispr onboarding</h2>
      <Switch id="wispr-lab-toggle" className="agent-switch" checked={facts?.wisprSaved??false} aria-labelledby="wispr-lab-label" aria-describedby="wispr-lab-help" aria-busy={busy&&setting==='wisprFlow'}
        disabled={busy||!facts||Boolean(facts.error)||!facts.wisprSupported} onCheckedChange={value=>void request(value,'wisprFlow')} /></div>
      <p id="wispr-lab-help">Avoid shortcut clashes during setup. macOS only. Off by default.</p>
    </section>
    <span role="status" className="sr-only">{busy?(operation==='save'?'Saving preference':'Reading saved preference'):''}</span>
    {(!facts||facts.error)&&!busy&&!error&&<Button id="labs-refresh" variant="secondary" onClick={()=>void request(undefined,setting)}>Refresh preference</Button>}
    <ErrorDialog open={!!error} title={!facts?'Preference not confirmed':facts.error==='config_read_failed'?'Unable to read preference':'Unable to save preference'} description={error} artwork={<img src={frog} alt=""/>} recoveryLabel="Refresh preference" busy={busy}
      restoreFocus={()=>{const target=document.getElementById(setting==='wisprFlow'?'wispr-lab-toggle':setting==='sharing'?'public-sharing-toggle':'auto-paste-toggle') as HTMLButtonElement|null;(target&&!target.disabled?target:document.getElementById('labs-refresh'))?.focus();}}
      onRecover={()=>void request(undefined,setting)} onClose={()=>setError('')}/>
  </section>;
}
