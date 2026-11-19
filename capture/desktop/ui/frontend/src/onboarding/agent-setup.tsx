import {useEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import agentArt from '../../../../assets/onboarding/agents-transparent.png';
function AgentArt({cloud=false}:{cloud?:boolean}) {return <span aria-hidden="true" className={`native-agent-art ${cloud?'cloud':'local'}`} style={{backgroundImage:`url(${agentArt})`}}/>;}
import {useConnectFlow, type ConnectBridge} from '../connect/flow';
import { TourAction } from '../../../../../../onboarding/renderer/tour-actions';

const bridge: ConnectBridge = {
  read: () => window.nativeOnboarding?.readConnect() ?? Promise.resolve({status:'disconnected'}),
  command: action => window.nativeOnboarding?.connect(action) ?? Promise.resolve({status:'disconnected'}),
  close: () => window.nativeOnboarding?.closeConnect(),
};

export function AgentSetup({onContinue,onLater}:{onContinue:()=>Promise<void>;onLater:()=>Promise<void>}) {
  const [page,setPage]=useState<'agent'|'help'|'connect'>('agent');
  const content=useRef<HTMLDivElement>(null);
  useEffect(()=>{const heading=content.current?.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}},[page]);
  return <div className="native-agent-setup" ref={content}>
    {page==='agent'&&<><h1>Where’s ur agent at?</h1><div className="native-agent-choices">
      <Button variant="outline" onClick={()=>void onContinue()}><AgentArt/><strong>Right here</strong></Button>
      <Button variant="outline" onClick={()=>setPage('connect')}><AgentArt cloud/><strong>Up in the cloud</strong></Button>
    </div><Button variant="ghost" className="native-agent-idk" onClick={()=>setPage('help')}>idk?? →</Button></>}
    {page==='help'&&<><h1>Let’s figure it out.</h1><p>Can ur agent open files on this computer?</p>
      <div className="native-agent-explanation"><h2>Yes, it can open my files</h2><p>An agent in a terminal or editor can read captures directly.</p><Button variant="outline" onClick={()=>void onContinue()}>Right here →</Button></div>
      <div className="native-agent-explanation"><h2>No, I send it files or links</h2><p>Connect <strong className="native-brand-name">apparent</strong> for an agent in a browser or on another computer.</p><Button variant="outline" onClick={()=>setPage('connect')}>Up in the cloud →</Button></div>
      <Button variant="ghost" onClick={()=>setPage('agent')}>Back</Button></>}
    {page==='connect'&&<ConnectSetup onContinue={onContinue}/>}
    <TourAction action="later" onAction={onLater}/>
  </div>;
}

function ConnectSetup({onContinue}:{onContinue:()=>Promise<void>}) {
  const {view,result,busy,request,browserFailed}=useConnectFlow(bridge);
  const [leaving,setLeaving]=useState(false);
  const advanced=useRef(false);
  const phase=view?.phase;
  useEffect(()=>{
    if(advanced.current||busy||!view)return;
    if((!leaving&&phase==='connected')||(leaving&&view.localReady)){
      advanced.current=true;void onContinue();
    }
  },[phase,busy,leaving,view?.localReady,onContinue]);
  async function local(){setLeaving(true);await request('disable');}
  const waiting=phase==='starting'||phase==='approval'||phase==='cancelling'||phase==='checking'||phase==='enabling';
  const unavailable=result.status!=='connected'||!phase;
  const recovery=view?.buttons.find(b=>b.enabled && (b.command==='connect'||b.command==='check'&&!view.presentation?.menuActions.includes('check')));
  const action=recovery?.command==='check'?'check':'connect';
  return <><h1>{phase==='waitlisted'?'Ur spot is saved.':waiting?view?.presentation?.headline??'Finish in ur browser.':'Meet in the cloud.'}</h1>
    <AgentArt cloud/>
    {phase==='waitlisted'?<><p>You’re on the Connect waitlist. <strong className="native-brand-name">apparent</strong> still works on this computer.</p><Button disabled={busy||leaving} onClick={()=>void local()}>Continue locally</Button></>:
      <><p>Connect <strong className="native-brand-name">apparent</strong>. Give ur agent a link.</p>
      {!waiting&&<><p className="native-connect-disclosure">Continuing requests upload access for new captures, including screen images, voice, transcript and context. Older captures stay local. Approve this computer in ur browser.</p>
        <Button disabled={busy||leaving||unavailable} onClick={()=>void request(action)}>{recovery?.title==='Connect with Google'?'Continue with Google':recovery?.title??'Continue with Google'}</Button></>}
      {phase==='approval'&&browserFailed&&<Button disabled={busy||leaving} onClick={()=>void request('open-browser')}>Try opening browser</Button>}
      {(phase==='failed'||action==='check')&&<p role="status">{view?.detail}</p>}
      {unavailable&&!busy&&<p role="alert">Connect is unavailable. Try again to continue locally.</p>}
      <Button variant="ghost" disabled={busy||leaving||phase==='cancelling'} onClick={()=>void local()}>Keep it local</Button></>}
    {phase==='cancelling'&&<p role="status">Turning uploads off before continuing…</p>}
    {leaving&&!view?.localReady&&phase!=='cancelling'&&<Button disabled={busy} onClick={()=>void local()}>Retry cancellation</Button>}
  </>;
}
