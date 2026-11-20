import './agents/bridge';
import type {PairingPreview} from '../../electron/settings/t3';
import {useEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {ErrorDialog} from '@apparent/ui/error-dialog';
import frog from '../../../../assets/settings/frog-puzzled.png';
import {Switch} from '@apparent/ui/switch';
import {Input} from '@apparent/ui/input';
import {t3PickerEnabled,type PreferenceFacts} from './agents/policy';

const refreshSending = 'Refresh to check whether sending to T3 is enabled, then try again.';

export function T3Settings() {
  const [facts,setFacts]=useState<PreferenceFacts>();
  const [busy,setBusy]=useState(false),[operation,setOperation]=useState<'read'|'save'>('read');
  const [setting,setSetting]=useState<'t3'>('t3'),[error,setError]=useState('');
  const [connecting,setConnecting]=useState(false),[disconnecting,setDisconnecting]=useState(false),[connectionError,setConnectionError]=useState('');
  const [connectionNotice,setConnectionNotice]=useState('');
  const [setup,setSetup]=useState(false),[preview,setPreview]=useState<PairingPreview>();
  const [server,setServer]=useState('http://127.0.0.1:3773');
  const dialog=useRef<HTMLDialogElement>(null),previewRevision=useRef(0);
  useEffect(()=>{if(setup)dialog.current?.showModal();},[setup]);
  function closeSetup(){if(connecting)return;++previewRevision.current;dialog.current?.close();setSetup(false);setPreview(undefined);void window.apparentAgents.cancelT3().catch(()=>{});}
  function openSetup(){setConnectionError('');setServer(facts?.t3Configured?'':'http://127.0.0.1:3773');setSetup(true);}
  function changeServer(value:string){++previewRevision.current;setServer(value);setPreview(undefined);setConnectionError('');void window.apparentAgents.cancelT3().catch(()=>{});}
  async function pasteLink(){const revision=++previewRevision.current;setConnectionError('');setPreview(undefined);try{const result=await window.apparentAgents.previewT3(server);if(!live.current||revision!==previewRevision.current)return;if(result.error)setConnectionError(result.error);else setPreview(result.preview);}catch{if(live.current&&revision===previewRevision.current)setConnectionError('Unable to read the pairing code or link. Copy it in T3, then try again.');}}
  const live=useRef(true),pending=useRef(false),revision=useRef(0);
  async function request(enabled?:boolean,target:'t3'='t3') {
    if(pending.current)return;
    pending.current=true;setOperation(enabled===undefined?'read':'save');setSetting(target);setBusy(true);
    const version=++revision.current;
    try {
      const result=await(enabled===undefined?window.apparentAgents.read():window.apparentAgents.saveT3(enabled));
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
  async function connect(disconnect=false,origin?:string) {
    setConnecting(true);setDisconnecting(disconnect);setConnectionError('');setConnectionNotice('');
    try {
      let result:PreferenceFacts;
      if(disconnect)result=await window.apparentAgents.disconnectT3(origin);
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
    } catch {if(live.current)setConnectionError(disconnect?'Disconnection was not confirmed. Refresh the connection to check its status.':'Couldn’t connect. Paste a fresh T3 link and try again.');}
    finally {if(live.current){setConnecting(false);setDisconnecting(false);setPreview(undefined);}}
  }
  const t3Enabled=facts&&t3PickerEnabled(facts);
  const restoreSendingFocus = useRef(false);

  return <section className="settings-agents settings-t3" aria-labelledby="agent-t3-label">
    <div className="agent-preference">
      <h2 id="agent-t3-label" tabIndex={-1}>Send recordings to T3</h2>
      <ol className="settings-t3-steps">
        <li>
          <p><strong>Connect a computer</strong></p>
          <p>Pair a computer to see its threads in Apparent.</p>
          <div className="settings-t3-connection">
            {disconnecting&&<p role="status">Disconnecting…</p>}
            {(facts?.t3Connections??(facts?.t3Origin?[{origin:facts.t3Origin,expiresAt:facts.t3ExpiresAt??0}]:[])).map(computer=><div key={computer.origin} className="settings-t3-computer">
              <p>{new URL(computer.origin).host}{computer.expiresAt<=Date.now()?' · Expired. Use Add computer to pair it again.':''}</p>
              <Button variant="secondary" disabled={busy||connecting} aria-label={`Disconnect ${new URL(computer.origin).host}`} onClick={()=>void connect(true,computer.origin)}>Disconnect</Button>
            </div>)}
            <Button disabled={busy||!facts||Boolean(facts.error)||connecting} onClick={openSetup}>{facts?.t3Configured?'Add computer':'Connect T3'}</Button>
          </div>
          {connectionNotice&&<p role="status" className="settings-metadata">{connectionNotice}</p>}
        </li>
        <li>
          <div className="agent-preference-row" ref={row => {
            if (!row || busy || t3Enabled === undefined || !restoreSendingFocus.current) return;
            restoreSendingFocus.current = false;
            if (document.activeElement === document.body)
              row.querySelector<HTMLButtonElement>('#agent-t3-control')?.focus();
          }}>
            <div>
              <p><strong id="agent-t3-enable">Enable sending to T3</strong></p>
              {t3Enabled !== undefined && <span role="status" className={busy && operation==='save'?'settings-metadata':'sr-only'}>{busy?(operation==='save'?'Saving the T3 sending preference…':'Reading the T3 sending preference…'):''}</span>}
            </div>
            {t3Enabled !== undefined && (
              <Switch id="agent-t3-control" className="agent-switch" checked={t3Enabled} aria-labelledby="agent-t3-enable" aria-describedby="agent-t3-help" aria-busy={busy&&setting==='t3'} disabled={busy||connecting} onCheckedChange={value=>void request(value,'t3')} />
            )}
          </div>
          {t3Enabled === undefined ? (
            <>
              <p id="agent-t3-unconfirmed" role="status">
                {busy ? 'Checking whether T3 sending is on…' : 'The saved T3 sending preference is unconfirmed.'}
              </p>
              <Button
                id="agent-refresh"
                variant="secondary"
                aria-describedby="agent-t3-unconfirmed"
                aria-disabled={busy || connecting}
                onClick={event => {
                  if (busy || connecting) return;
                  restoreSendingFocus.current = document.activeElement === event.currentTarget;
                  void request();
                }}
              >
                Refresh T3 sending
              </Button>
            </>
          ) : (
            <p id="agent-t3-help">Applies from your next recording. You choose what to send.</p>
          )}
        </li>
        <li>
          <p><strong>Choose a thread</strong></p>
          <p>Once a computer is connected and sending is on, choose a thread in the recording pill during processing. Apparent sends the recording when it’s ready.</p>
        </li>
      </ol>
    </div>
    {setup&&<dialog ref={dialog} className="settings-t3-dialog" aria-labelledby="t3-setup-title" onCancel={event=>{event.preventDefault();closeSetup();}}>
      <h2 id="t3-setup-title">Connect T3</h2>
      <p>Threads from all connected computers appear together.</p>
      <p className="settings-metadata">In T3, go to <strong>Settings → Sharing &amp; access → Authorized clients</strong>. Create a link with <strong>View environment</strong> and <strong>Operate tasks</strong>, then copy it.</p>
      <details className="settings-t3-server"><summary>Use a code instead</summary><label htmlFor="t3-server">MCP URL or server address</label>
        <Input id="t3-server" type="url" value={server} maxLength={2048} autoComplete="url" spellCheck={false} aria-describedby="t3-server-help" disabled={connecting} onChange={event=>changeServer(event.target.value)} />
        <p id="t3-server-help" className="settings-metadata">In T3 <strong>Settings → Environments</strong>, choose <strong>Copy MCP URL</strong> from the computer’s menu. Paste it above, then copy the computer’s pairing code and choose <strong>Paste link or code</strong>.</p>
      </details>
      {preview&&<div className="settings-t3-preview"><p>Connect to</p><strong>{preview.origin}</strong><p>Apparent can read threads and send recordings you select. Connecting alone does not enable sending.</p></div>}
      {connecting&&<p role="status">Connecting…</p>}
      {connectionError&&<p role="alert">{connectionError}</p>}
      <div className="settings-t3-dialog-actions">{preview&&<Button disabled={connecting} onClick={()=>void connect()}>Connect</Button>}<Button variant={preview?'outline':'default'} className={preview?'settings-decision-alternative':undefined} disabled={connecting} onClick={()=>void pasteLink()}>{preview?'Paste another':'Paste link or code'}</Button><Button variant="outline" className="settings-decision-alternative" disabled={connecting} onClick={closeSetup}>Cancel</Button></div>
    </dialog>}

    <ErrorDialog open={!!error} title={!facts?'T3 sending preference unconfirmed':facts.error==='config_read_failed'?'Unable to read T3 sending preference':'Unable to save T3 sending preference'} description={refreshSending} artwork={<img src={frog} alt=""/>} recoveryLabel="Refresh T3 sending" busy={busy}
      restoreFocus={()=>{const control=document.getElementById(`agent-${setting}-control`) as HTMLButtonElement|null;(control&&!control.disabled?control:document.getElementById('agent-refresh'))?.focus();}}
      onRecover={()=>void request(undefined,setting)} onClose={()=>setError('')}/>
    <ErrorDialog open={!!connectionError&&!setup} title="T3 connection not confirmed" description={connectionError} recoveryLabel="Refresh connection" busy={busy||connecting} artwork={<img src={frog} alt=""/>} onRecover={()=>{setConnectionError('');void request(undefined,'t3');}} onClose={()=>setConnectionError('')}/>
  </section>;
}
