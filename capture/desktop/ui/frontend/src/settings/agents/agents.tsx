import './bridge';
import {useEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {ErrorDialog} from '@apparent/ui/error-dialog';
import frog from '../../../../../assets/settings/frog-puzzled.png';
import {Switch} from '@apparent/ui/switch';
import {Copy,Check} from 'lucide-react';
import {preferenceEnabled,skillCommand,type PreferenceFacts} from './policy';

import {Help} from '../help';
export function Agents() {
  const [facts,setFacts]=useState<PreferenceFacts>();
  const [busy,setBusy]=useState(false),[operation,setOperation]=useState<'read'|'save'>('read');
  const [setting,setSetting]=useState<'video'>('video'),[error,setError]=useState('');
  const [copied,setCopied]=useState(false),[copyError,setCopyError]=useState(false);
  const live=useRef(true),pending=useRef(false),revision=useRef(0);
  async function request(enabled?:boolean,target:'video'='video') {
    if(pending.current)return;
    pending.current=true;setOperation(enabled===undefined?'read':'save');setSetting(target);setBusy(true);
    const version=++revision.current;
    try {
      const result=await(enabled===undefined?window.apparentAgents.read():window.apparentAgents.save(enabled));
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
    void request();return()=>{live.current=false;unsubscribe();};
  },[]);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2500);return()=>clearTimeout(timer);},[copied]);
  async function copy(){setCopied(false);try{await window.apparentAgents.copySkill();if(live.current){setCopied(true);setCopyError(false);}}catch{if(live.current)setCopyError(true);}}
  const enabled=facts&&preferenceEnabled(facts);

  return <section className="settings-agents" aria-label="Agent preferences">
    <section className="settings-agent-skill" aria-labelledby="agent-skill-label">
      <div className="agent-heading"><h2 id="agent-skill-label">Agent skill</h2><Help label="About the agent skill">Optional: run this in a terminal to teach Claude Code, OpenCode, Codex and other agents to read your captures. This is not needed to connect T3.</Help></div>
      <div className="agent-command"><code>{skillCommand.split('/').map((part,index)=><span key={index}>{index>0&&<>/<wbr/></>}{part}</span>)}</code><Button variant="ghost" className="agent-copy" aria-label="Copy install command" onClick={()=>void copy()}>{copied?<Check aria-hidden="true" />:<Copy aria-hidden="true" />}</Button></div>
      <span role="status" className="settings-metadata">{copied?'Copied':''}</span>
    </section>
    <section className="agent-preference"><div className="agent-preference-row"><h2 className="settings-preference-label" id="agent-video-label">Ask for video proof</h2><Switch id="agent-video-control" className="agent-switch" checked={enabled} aria-labelledby="agent-video-label" aria-describedby="agent-video-help" aria-busy={busy&&setting==='video'} disabled={busy} onCheckedChange={value=>void request(value)} /></div><p id="agent-video-help">Requests a video for complex visual changes when the agent can record.</p></section>
    <span role="status" className="sr-only">{busy?(operation==='save'?'Saving preference':'Reading saved preference'):''}</span>
    {(!facts||facts.error)&&!busy&&!error&&<Button id="agent-refresh" variant="secondary" onClick={()=>void request()}>Refresh preference</Button>}
    <ErrorDialog open={!!error} title={!facts?'Preference not confirmed':facts.error==='config_read_failed'?'Unable to read preference':'Unable to save preference'} description={error} artwork={<img src={frog} alt=""/>} recoveryLabel="Refresh preference" busy={busy}
      restoreFocus={()=>{const control=document.getElementById(`agent-${setting}-control`) as HTMLButtonElement|null;(control&&!control.disabled?control:document.getElementById('agent-refresh'))?.focus();}}
      onRecover={()=>void request(undefined,setting)} onClose={()=>setError('')}/>
    <ErrorDialog open={copyError} title="Unable to copy command" description="Select the command and copy it manually, or try again." artwork={<img src={frog} alt=""/>} recoveryLabel="Try again" onRecover={()=>void copy()} onClose={()=>setCopyError(false)}/>
  </section>;
}
