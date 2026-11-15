import type {PairingPreview} from '../../electron/settings/t3';
import {useEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {ErrorDialog} from '@apparent/ui/error-dialog';
import frog from '../../../../assets/settings/frog-puzzled.png';
import {Switch} from '@apparent/ui/switch';
import {Input} from '@apparent/ui/input';
import {Tooltip,TooltipTrigger,TooltipContent,TooltipProvider} from '@apparent/ui/tooltip';
import {Info,Copy,Check} from 'lucide-react';
import {preferenceEnabled,t3PickerEnabled,skillCommand,type PreferenceFacts,type T3ConnectionResult} from './policy';

declare global {
  interface Window {
    apparentAgents: {
      read():Promise<PreferenceFacts>;
      save(enabled:boolean):Promise<PreferenceFacts>;
      saveT3(enabled:boolean):Promise<PreferenceFacts>;
      previewT3(server:string):Promise<{preview:PairingPreview;error?:never}|{error:string;preview?:never}>;
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
  const [server,setServer]=useState('http://127.0.0.1:3773');
  const dialog=useRef<HTMLDialogElement>(null),previewRevision=useRef(0);
  useEffect(()=>{if(setup)dialog.current?.showModal();},[setup]);
  function closeSetup(){if(connecting)return;++previewRevision.current;setSetup(false);setPreview(undefined);void window.apparentAgents.cancelT3().catch(()=>{});}
  function openSetup(){setConnectionError('');setServer(facts?.t3Origin??'http://127.0.0.1:3773');setSetup(true);}
  function changeServer(value:string){++previewRevision.current;setServer(value);setPreview(undefined);setConnectionError('');void window.apparentAgents.cancelT3().catch(()=>{});}
  async function pasteLink(){const revision=++previewRevision.current;setConnectionError('');setPreview(undefined);try{const result=await window.apparentAgents.previewT3(server);if(!live.current||revision!==previewRevision.current)return;if(result.error)setConnectionError(result.error);else setPreview(result.preview);}catch{if(live.current&&revision===previewRevision.current)setConnectionError('Unable to read the pairing code or link. Copy it in T3, then try again.');}}
  const live=useRef(true),pending=useRef(false),revision=useRef(0);
  async function request(enabled?:boolean,target:'video'|'t3'='video') {
    if(pending.current)return;
    pending.current=true;setOperation(enabled===undefined?'read':'save');setSetting(target);setBusy(true);
    const version=++revision.current;
    try {
      const result=await(enabled===undefined?window.apparentAgents.read():target==='t3'?window.apparentAgents.saveT3(enabled):window.apparentAgents.save(enabled));
      if(!live.current||version!==revision.current)return;
      setFacts(result);
      setError(result.error?'Refresh the saved value, then try again.':'');
    } catch {
      if(live.current){setFacts(undefined);setError('The app did not confirm the saved value. Refresh to check it.');}
    } finally {pending.current=false;if(live.current)setBusy(false);}
  }
  useEffect(()=>{
    live.current=true;
    const unsubscribe=window.apparentAgents.subscribe(value=>{if(live.current&&!pending.current){++revision.current;setFacts(value);setError(value.error?'Refresh the saved value, then try again.':'');}});
    void request();return()=>{live.current=false;++previewRevision.current;void window.apparentAgents.cancelT3().catch(()=>{});unsubscribe();};
  },[]);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2500);return()=>clearTimeout(timer);},[copied]);
  async function copy(){setCopied(false);try{await window.apparentAgents.copySkill();if(live.current){setCopied(true);setCopyError(false);}}catch{if(live.current)setCopyError(true);}}
  async function connect(disconnect=false) {
    setConnecting(true);setDisconnecting(disconnect);setConnectionError('');setConnectionNotice('');
    try {
      let result:PreferenceFacts;
      if(disconnect)result=await window.apparentAgents.disconnectT3();
      else {
        const outcome=await window.apparentAgents.connectT3(preview!.id);
        if(outcome.reason){
          const message={cancelled:'Connection cancelled. Paste a fresh code or link to try again.',
            unavailable:'Couldn’t connect. Check the server address and create a fresh code or link in T3.',
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
    } catch {if(live.current)setConnectionError(disconnect?'Disconnection was not confirmed. Refresh the connection to check its status.':'Couldn’t connect. Paste a fresh pairing code or link and try again.');}
    finally {if(live.current){setConnecting(false);setDisconnecting(false);setPreview(undefined);}}
  }
  const enabled=facts&&preferenceEnabled(facts),t3Enabled=facts&&t3PickerEnabled(facts);
  const expired=Boolean(facts?.t3Configured&&(!facts.t3Origin||!facts.t3ExpiresAt||facts.t3ExpiresAt<=Date.now()));
  return <section className="settings-agents" aria-label="Agent preferences">
    <section className="settings-agent-skill" aria-labelledby="agent-skill-label">
      <div className="agent-heading"><h2 id="agent-skill-label">Agent skill</h2><Help label="About the agent skill">Optional: run this in a terminal to teach Claude Code, OpenCode, Codex and other agents to read your captures. This is not needed to connect T3.</Help></div>
      <div className="agent-command"><code>{skillCommand.split('/').map((part,index)=><span key={index}>{index>0&&<>/<wbr/></>}{part}</span>)}</code><Button variant="ghost" className="agent-copy" aria-label="Copy install command" onClick={()=>void copy()}>{copied?<Check aria-hidden="true" />:<Copy aria-hidden="true" />}</Button></div>
      <span role="status" className="settings-metadata">{copied?'Copied':''}</span>
    </section>
    <section className="agent-preference"><div className="agent-preference-row"><h2 className="settings-preference-label" id="agent-video-label">Ask for video proof</h2><Switch id="agent-video-control" className="agent-switch" checked={enabled??false} aria-labelledby="agent-video-label" aria-describedby="agent-video-help" aria-busy={busy&&setting==='video'} disabled={busy||enabled===undefined||connecting} onCheckedChange={value=>void request(value)} /></div><p id="agent-video-help">Requests a video for complex visual changes when the agent can record.</p></section>
    <section className="agent-preference" aria-labelledby="agent-t3-label">
      <div className="agent-preference-row"><div className="agent-heading"><h2 className="settings-preference-label" id="agent-t3-label">Send recordings to T3</h2><Help label="About sending to T3">Choose a thread from the recording pill while a recording is processing. The recording sends when ready. Off by default. Connecting alone does not enable sending.</Help></div><Switch id="agent-t3-control" className="agent-switch" checked={t3Enabled??false} aria-labelledby="agent-t3-label" aria-describedby="agent-t3-help" aria-busy={busy&&setting==='t3'} disabled={busy||t3Enabled===undefined||connecting} onCheckedChange={value=>void request(value,'t3')} /></div><p id="agent-t3-help">Choose a thread from the recording pill. Off by default; applies to the next recording.</p>
      <div className="settings-t3-connection">
        {disconnecting?<p role="status">Disconnecting…</p>
          :facts&&!facts.error&&facts.t3Configured?<><p role="status">{expired?(facts.t3ExpiresAt&&facts.t3ExpiresAt<=Date.now()?'Connection expired':'Connection needs attention'):facts.t3Origin?`Connected to ${new URL(facts.t3Origin).host}`:'Connection saved'}</p>{expired&&<Button disabled={busy} onClick={openSetup}>Reconnect T3</Button>}<Button variant="secondary" disabled={busy||connecting} onClick={()=>void connect(true)}>Disconnect</Button></>
          :<><p>Connect once to show your threads in the pill.</p><Button disabled={busy||!facts||Boolean(facts.error)} onClick={openSetup}>Connect T3</Button></>}
      </div>
      {facts?.t3Configured&&!expired&&!t3Enabled&&<p className="settings-t3-next">Turn on sending to use the picker.</p>}
      {connectionNotice&&<p role="status" className="settings-metadata">{connectionNotice}</p>}
    </section>
    {setup&&<dialog ref={dialog} className="settings-t3-dialog" aria-labelledby="t3-setup-title" onCancel={event=>{event.preventDefault();closeSetup();}}>
      <h2 id="t3-setup-title">Connect T3</h2>
      <p>Pair once to choose a thread from your recording pill.</p>
      <ol>
        <li>In T3, open <strong>Settings → Sharing &amp; access</strong>.</li>
        <li>Under <strong>Authorized clients</strong>, choose <strong>Create link</strong>. Select View environment and Operate tasks, then create the link.</li>
        <li>Copy the code or link, then return here.</li>
      </ol>
      <div className="settings-t3-server"><label htmlFor="t3-server">T3 server address</label>
        <Input id="t3-server" type="url" value={server} maxLength={2048} autoComplete="url" spellCheck={false} aria-describedby="t3-server-help" disabled={connecting} onChange={event=>changeServer(event.target.value)} />
        <p id="t3-server-help" className="settings-metadata">For codes only. Full links include the address.</p>
      </div>
      {preview&&<div className="settings-t3-preview"><p>Connect to</p><strong>{preview.origin}</strong><p>Apparent can read threads and send recordings you select.</p></div>}
      {connecting&&<p role="status">Connecting…</p>}
      {connectionError&&<p role="alert">{connectionError}</p>}
      <div className="settings-t3-dialog-actions">{preview&&<Button disabled={connecting} onClick={()=>void connect()}>Connect</Button>}<Button variant={preview?'outline':'default'} className={preview?'settings-decision-alternative':undefined} disabled={connecting} onClick={()=>void pasteLink()}>{preview?'Paste another':'Paste code or link'}</Button><Button variant="outline" className="settings-decision-alternative" disabled={connecting} onClick={closeSetup}>Cancel</Button></div>
    </dialog>}

    <span role="status" className="sr-only">{busy?(operation==='save'?'Saving preference':'Reading saved preference'):''}</span>
    {(!facts||facts.error)&&!busy&&!error&&<Button id="agent-refresh" variant="secondary" onClick={()=>void request()}>Refresh preference</Button>}
    <ErrorDialog open={!!error} title={!facts?'Preference not confirmed':facts.error==='config_read_failed'?'Unable to read preference':'Unable to save preference'} description={error} artwork={<img src={frog} alt=""/>} recoveryLabel="Refresh preference" busy={busy}
      restoreFocus={()=>{const control=document.getElementById(`agent-${setting}-control`) as HTMLButtonElement|null;(control&&!control.disabled?control:document.getElementById('agent-refresh'))?.focus();}}
      onRecover={()=>void request(undefined,setting)} onClose={()=>setError('')}/>
    <ErrorDialog open={copyError} title="Unable to copy command" description="Select the command and copy it manually, or try again." artwork={<img src={frog} alt=""/>} recoveryLabel="Try again" onRecover={()=>void copy()} onClose={()=>setCopyError(false)}/>
    <ErrorDialog open={!!connectionError&&!setup} title="T3 connection not confirmed" description={connectionError} recoveryLabel="Refresh connection" busy={busy||connecting} artwork={<img src={frog} alt=""/>} onRecover={()=>{setConnectionError('');void request(undefined,'t3');}} onClose={()=>setConnectionError('')}/>
  </section>;
}
