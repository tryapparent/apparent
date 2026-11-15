import {useEffect,useRef,useState} from 'react';
import {Button} from '@apparent/ui/button';
import {Switch} from '@apparent/ui/switch';

export type LabsFacts = {saved:boolean|null;supported:boolean;error?:never}|{error:'config_read_failed'|'config_write_failed';saved?:never;supported?:never};
declare global {interface Window {apparentLabs:{read():Promise<LabsFacts>;save(enabled:boolean):Promise<LabsFacts>;subscribe(callback:(facts:LabsFacts)=>void):()=>void}}}

export function Labs(){
  const [facts,setFacts]=useState<LabsFacts>(),[busy,setBusy]=useState(true),[error,setError]=useState('');
  const live=useRef(true),pending=useRef(false);
  async function request(enabled?:boolean){
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');
    try{
      const result=await(enabled===undefined?window.apparentLabs.read():window.apparentLabs.save(enabled));
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
  return <section className="settings-labs" aria-label="Experiments">
    <div className="settings-agent-preference"><div>
      <h2 id="auto-paste-label">Auto paste</h2>
      <p id="auto-paste-help">Paste the image and text into your focused composer after recording. Off by default; applies to the next recording.</p>
      <p id="auto-paste-limits">Linux with Hyprland only. Keep your composer focused until processing finishes. Check the paste before sending; Apparent never presses Enter.</p>
    </div><Switch checked={facts?.saved??false} aria-labelledby="auto-paste-label" aria-describedby="auto-paste-help auto-paste-limits"
      disabled={busy||!facts||Boolean(facts.error)||!facts.supported} onCheckedChange={value=>void request(value)} /></div>
    <p role="status" className="settings-metadata settings-preference-status">{busy?'Checking experiment…':''}</p>
    {error&&<div className="settings-preference-error"><p role="alert">{error}</p><Button variant="secondary" disabled={busy} onClick={()=>void request()}>Refresh preference</Button></div>}
  </section>;
}
