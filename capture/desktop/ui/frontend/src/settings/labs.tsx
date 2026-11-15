import {useEffect,useRef,useState} from 'react';
import {Button} from '@apparent/ui/button';
import {Switch} from '@apparent/ui/switch';

type LabsSetting = 'autoPaste'|'sharing';
export type LabsFacts = {saved:boolean|null;supported:boolean;sharingSaved:boolean|null;error?:never}|{error:'config_read_failed'|'config_write_failed';saved?:never;supported?:never;sharingSaved?:never};
declare global {interface Window {apparentLabs:{read():Promise<LabsFacts>;save(enabled:boolean,setting?:LabsSetting):Promise<LabsFacts>;subscribe(callback:(facts:LabsFacts)=>void):()=>void}}}

export function Labs(){
  const [facts,setFacts]=useState<LabsFacts>(),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const live=useRef(true),pending=useRef(false),restoreFocus=useRef<string|null>(null);
  async function request(enabled?:boolean,setting:LabsSetting='autoPaste'){
    if(pending.current)return;
    if(enabled!==undefined){
      const active=document.activeElement;
      restoreFocus.current=active?.matches('.settings-labs button[role="switch"]:focus-visible')?active.id:null;
    }
    pending.current=true;setBusy(true);setError('');
    try{
      const result=await(enabled===undefined?window.apparentLabs.read():window.apparentLabs.save(enabled,setting));
      if(!live.current)return;
      setFacts(result);
      if(result.error)setError('Unable to read or save this experiment. Refresh, then try again.');
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
    <section className="settings-agent-group">
    <div className="settings-agent-preference"><div>
      <h2 id="auto-paste-label">Auto paste</h2>
      <p id="auto-paste-help">Paste the image and text into your focused composer after recording. Off by default; applies to the next recording.</p>
      <p id="auto-paste-limits">Linux with Hyprland only. Keep your composer focused until processing finishes. Check the paste before sending; Apparent never presses Enter.</p>
    </div><Switch id="auto-paste-toggle" checked={facts?.saved??false} aria-labelledby="auto-paste-label" aria-describedby="auto-paste-help auto-paste-limits"
      disabled={busy||!facts||Boolean(facts.error)||!facts.supported} onCheckedChange={value=>void request(value)} /></div>
    </section>
    <section className="settings-agent-group">
      <div className="settings-agent-preference"><div>
        <h2 id="public-sharing-label">Public sharing links</h2>
        <p id="public-sharing-help">Show Copy link after recording. Off by default; applies to the next recording.</p>
        <p id="public-sharing-limits">Anyone with the link can view the shared capture. Shared captures are not end-to-end encrypted.</p>
      </div><Switch id="public-sharing-toggle" checked={facts?.sharingSaved??false} aria-labelledby="public-sharing-label" aria-describedby="public-sharing-help public-sharing-limits"
        disabled={busy||!facts||Boolean(facts.error)} onCheckedChange={value=>void request(value,'sharing')} /></div>
    </section>
    <p role="status" className="settings-metadata settings-preference-status">{busy?'Checking experiment…':''}</p>
    {error&&<div className="settings-preference-error"><p role="alert">{error}</p><Button variant="secondary" disabled={busy} onClick={()=>void request()}>Refresh preference</Button></div>}
  </section>;
}
