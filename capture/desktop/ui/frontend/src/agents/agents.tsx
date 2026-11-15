import type {PairingPreview} from '../../electron/settings/t3';
import {useEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {Switch} from '@apparent/ui/switch';
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@apparent/ui/tooltip';
import {Info,Copy,Check} from 'lucide-react';
import {preferenceEnabled,t3PickerEnabled,skillCommand,type PreferenceFacts,type T3ConnectionResult} from './policy';

declare global {
  interface Window {
    apparentAgents: {
      read():Promise<PreferenceFacts>;
      save(enabled:boolean):Promise<PreferenceFacts>;
      saveT3(enabled:boolean):Promise<PreferenceFacts>;
      previewT3():Promise<{preview:PairingPreview;error?:never}|{error:string;preview?:never}>;
      connectT3(id:string):Promise<T3ConnectionResult>;
      cancelT3():Promise<void>;
      disconnectT3():Promise<PreferenceFacts>;
      copySkill():Promise<void>;
      subscribe(callback:(facts:PreferenceFacts)=>void):()=>void;
    };
  }
}

function Help({label,children}:{label:string;children:string}) {
  const [open,setOpen]=useState(false);
  return <TooltipProvider delayDuration={200}><Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild><Button type="button" variant="ghost" className="settings-help" aria-label={label} onClick={()=>setOpen(true)}><Info aria-hidden="true" /></Button></TooltipTrigger>
    <TooltipContent className="settings-help-content settings-agents-help">{children}</TooltipContent>
  </Tooltip></TooltipProvider>;
}

export function Agents() {
  const [facts,setFacts]=useState<PreferenceFacts>();
  const [busy,setBusy]=useState(false),[operation,setOperation]=useState<'read'|'save'>('read');
  const [setting,setSetting]=useState<'video'|'t3'>('video'),[error,setError]=useState('');
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  const [connecting,setConnecting]=useState(false),[disconnecting,setDisconnecting]=useState(false),[connectionError,setConnectionError]=useState('');
  const [connectionNotice,setConnectionNotice]=useState('');
  const [setup,setSetup]=useState(false),[preview,setPreview]=useState<PairingPreview>();
  const dialog=useRef<HTMLDialogElement>(null),previewRevision=useRef(0);
  useEffect(()=>{if(setup)dialog.current?.showModal();},[setup]);
  function closeSetup(){if(connecting)return;++previewRevision.current;setSetup(false);setPreview(undefined);void window.apparentAgents.cancelT3().catch(()=>{});}
  async function pasteLink(){const revision=++previewRevision.current;setConnectionError('');setPreview(undefined);try{const result=await window.apparentAgents.previewT3();if(!live.current||revision!==previewRevision.current)return;if(result.error)setConnectionError(result.error);else setPreview(result.preview);}catch{if(live.current&&revision===previewRevision.current)setConnectionError('Unable to read the pairing link. Copy it in T3, then try again.');}}
  const live=useRef(true),pending=useRef(false),revision=useRef(0);
  async function request(enabled?:boolean,target:'video'|'t3'='video') {
    if(pending.current)return;
    pending.current=true;setOperation(enabled===undefined?'read':'save');setSetting(target);setBusy(true);setError('');
    const version=++revision.current;
    try {
      const result=await(enabled===undefined?window.apparentAgents.read():target==='t3'?window.apparentAgents.saveT3(enabled):window.apparentAgents.save(enabled));
      if(!live.current||version!==revision.current)return;
      setFacts(result);
      if(result.error)setError(result.error==='config_read_failed'?'Unable to read this preference. Refresh to try again.':'Unable to save this preference. Refresh, then try again.');
    } catch {
      if(live.current){setFacts(undefined);setError('The app did not confirm this preference. Refresh to check the saved value.');}
    } finally {pending.current=false;if(live.current)setBusy(false);}
  }
  useEffect(()=>{
    live.current=true;
    const unsubscribe=window.apparentAgents.subscribe(value=>{if(live.current&&!pending.current){++revision.current;setFacts(value);setError(value.error?'Unable to read this preference. Refresh to try again.':'');}});
    void request();return()=>{live.current=false;unsubscribe();};
  },[]);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2500);return()=>clearTimeout(timer);},[copied]);
  async function copy(){setCopyError(false);setCopied(false);try{await window.apparentAgents.copySkill();if(live.current)setCopied(true);}catch{if(live.current)setCopyError(true);}}
  async function connect(disconnect=false) {
    setConnecting(true);setDisconnecting(disconnect);setConnectionError('');setConnectionNotice('');
    try {
      let result:PreferenceFacts;
      if(disconnect)result=await window.apparentAgents.disconnectT3();
      else {
        const outcome=await window.apparentAgents.connectT3(preview!.id);
        if(outcome.reason){
          const message={cancelled:'Connection cancelled. Paste a fresh link to try again.',
            unavailable:'Couldn’t connect. Create a fresh pairing link in T3 and try again.',
            unconfirmed:'The app did not confirm the saved connection. Refresh before trying again.'}[outcome.reason];
          if(live.current){
            if(outcome.reason==='unconfirmed')setFacts(undefined);
            (outcome.reason==='cancelled'?setConnectionNotice:setConnectionError)(message);
          }
          return;
        }
        result=outcome.facts;
      }
      if(!live.current)return;setFacts(result);if(!result.error){setSetup(false);setPreview(undefined);}
      if(result.error)setConnectionError('The app did not confirm the saved connection. Refresh before trying again.');
    } catch {if(live.current)setConnectionError(disconnect?'Disconnection was not confirmed. Refresh the connection to check its status.':'Couldn’t connect. Paste a fresh pairing link and try again.');}
    finally {if(live.current){setConnecting(false);setDisconnecting(false);setPreview(undefined);}}
  }
  const enabled=facts&&preferenceEnabled(facts),t3Enabled=facts&&t3PickerEnabled(facts);
  const expired=Boolean(facts?.t3Configured&&(!facts.t3Origin||!facts.t3ExpiresAt||facts.t3ExpiresAt<=Date.now()));
  const feedback=(target:'video'|'t3')=><>
    <p role="status" className="settings-metadata settings-preference-status">{setting===target&&busy?(operation==='save'?'Saving preference…':'Reading saved preference…'):''}</p>
    {error&&setting===target&&<div className="settings-preference-error"><p role="alert">{error}</p><Button variant="secondary" disabled={busy} onClick={()=>void request(undefined,target)}>Refresh preference</Button></div>}
  </>;
  return <section className="settings-agents" aria-label="Agent preferences">
    <section className="settings-agent-group">
      <div className="settings-agent-preference"><div>
        <div className="settings-agent-heading"><h2 id="agent-video-label">Ask for an Apparent video on complex changes</h2><Help label="About video requests">Adds a video request to copied and pasted captures when the agent can record the result. On by default.</Help></div>
        <p id="agent-video-help">Added to copied and pasted recordings.</p>
      </div><Switch checked={enabled??false} aria-labelledby="agent-video-label" aria-describedby="agent-video-help" disabled={busy||enabled===undefined||connecting} onCheckedChange={value=>void request(value)} /></div>
      {feedback('video')}
    </section>
    <section className="settings-agent-group" aria-labelledby="agent-t3-label">
      <div className="settings-agent-preference"><div>
        <div className="settings-agent-heading"><h2 id="agent-t3-label">Send recordings to T3</h2><Help label="About sending to T3">Choose a thread from the recording pill while a recording is processing. The recording sends when ready. Off by default. Connecting alone does not enable sending.</Help></div>
        <p id="agent-t3-help">Applies to the next recording.</p>
      </div><Switch checked={t3Enabled??false} aria-labelledby="agent-t3-label" aria-describedby="agent-t3-help" disabled={busy||t3Enabled===undefined||connecting} onCheckedChange={value=>void request(value,'t3')} /></div>
      {feedback('t3')}
      <div className="settings-t3-connection">
        {disconnecting?<p role="status">Disconnecting…</p>
          :facts&&!facts.error&&facts.t3Configured?<><p role="status">{expired?(facts.t3ExpiresAt&&facts.t3ExpiresAt<=Date.now()?'Connection expired':'Connection needs attention'):facts.t3Origin?`Connected to ${new URL(facts.t3Origin).host}`:'Connection saved'}</p>{expired&&<Button disabled={busy} onClick={()=>{setConnectionError('');setSetup(true);}}>Reconnect T3</Button>}<Button variant="secondary" disabled={busy||connecting} onClick={()=>void connect(true)}>Disconnect</Button></>
          :<><p>Connect once to show your threads in the pill.</p><Button disabled={busy||!facts||Boolean(facts.error)} onClick={()=>{setConnectionError('');setSetup(true);}}>Connect T3</Button></>}
      </div>
      {facts?.t3Configured&&!expired&&!t3Enabled&&<p className="settings-t3-next">Turn on sending to use the picker.</p>}
      {connectionNotice&&<p role="status" className="settings-metadata">{connectionNotice}</p>}
      {connectionError&&!setup&&<div><p role="alert">{connectionError}</p><Button variant="secondary" disabled={busy||connecting} onClick={()=>{setConnectionError('');void request(undefined,'t3');}}>Refresh connection</Button></div>}
    </section>
    {setup&&<dialog ref={dialog} className="settings-t3-dialog" aria-labelledby="t3-setup-title" onCancel={event=>{event.preventDefault();closeSetup();}}>
      <h2 id="t3-setup-title">Connect T3</h2>
      <p>Pair once to choose a thread from your recording pill.</p>
      <ol>
        <li>In T3, open <strong>Settings → Sharing &amp; access</strong>.</li>
        <li>Under <strong>Authorized clients</strong>, choose <strong>Create link</strong>. Select View environment and Operate tasks, then create the link.</li>
        <li>Choose <strong>Copy link</strong>, then return here.</li>
      </ol>
      <p className="settings-metadata">Use the full link, not “Copy code only”. No terminal needed.</p>
      {preview&&<div className="settings-t3-preview"><p>Connect to</p><strong>{preview.origin}</strong><p>Apparent can read threads and send recordings you select.</p></div>}
      {connecting&&<p role="status">Connecting…</p>}
      {connectionError&&<p role="alert">{connectionError}</p>}
      <div className="settings-t3-dialog-actions"><Button variant="secondary" disabled={connecting} onClick={closeSetup}>Cancel</Button><Button variant={preview?'secondary':'default'} disabled={connecting} onClick={()=>void pasteLink()}>{preview?'Paste another link':'Paste pairing link'}</Button>{preview&&<Button disabled={connecting} onClick={()=>void connect()}>Connect</Button>}</div>
    </dialog>}
    <section className="settings-agent-group settings-agent-skill" aria-labelledby="agent-skill-label">
      <div className="settings-agent-heading"><h2 id="agent-skill-label">Agent skill <span className="settings-metadata">(optional)</span></h2><Help label="About the agent skill">Optional: run this in a terminal to teach Claude Code, OpenCode, Codex and other agents to read your captures. This is not needed to connect T3.</Help></div>
      <div className="settings-agent-command"><code>{skillCommand}</code><Button variant="ghost" className="settings-command-copy" aria-label={copied?'Command copied':'Copy command'} onClick={()=>void copy()}>{copied?<Check aria-hidden="true" />:<Copy aria-hidden="true" />}</Button></div>
      <span role="status" className="sr-only">{copied?'Copied':''}</span>
      {copyError&&<p role="alert">Unable to copy. Try the copy icon again, or select and copy the command above.</p>}
    </section>
  </section>;
}
