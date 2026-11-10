import {useEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import localAgent from '../../../../assets/onboarding/local-agent.png';
import cloudAgent from '../../../../assets/onboarding/cloud-agent.png';
import {useConnectFlow, type ConnectBridge} from './connect-flow';

const bridge: ConnectBridge = {
  read: () => window.nativeOnboarding?.readConnect() ?? Promise.resolve({status:'disconnected'}),
  command: action => window.nativeOnboarding?.connect(action) ?? Promise.resolve({status:'disconnected'}),
  close: () => window.nativeOnboarding?.closeConnect(),
};

export function AgentSetup({onContinue}:{onContinue:()=>Promise<void>}) {
  const [page,setPage]=useState<'agent'|'help'|'connect'>('agent');
  const content=useRef<HTMLDivElement>(null);
  useEffect(()=>{const heading=content.current?.querySelector('h1');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}},[page]);
  return <div className="native-agent-setup" ref={content}>
    {page==='agent'&&<><h1>Where’s ur agent at?</h1><div className="native-agent-choices">
      <Button variant="outline" onClick={()=>void onContinue()}><img src={localAgent} alt=""/><strong>Right here</strong></Button>
      <Button variant="outline" onClick={()=>setPage('connect')}><img src={cloudAgent} alt=""/><strong>Up in the cloud</strong></Button>
    </div><Button variant="ghost" className="native-agent-idk" onClick={()=>setPage('help')}>idk?? →</Button></>}
    {page==='help'&&<><h1>Let’s figure it out.</h1><p>Can ur agent open files on this computer?</p>
      <div className="native-agent-explanation"><h2>Yes, it can open my files</h2><p>An agent in a terminal or editor can read captures directly.</p><Button variant="outline" onClick={()=>void onContinue()}>Right here →</Button></div>
      <div className="native-agent-explanation"><h2>No, I send it files or links</h2><p>Connect <strong className="native-brand-name">apparent</strong> for an agent in a browser or on another computer.</p><Button variant="outline" onClick={()=>setPage('connect')}>Up in the cloud →</Button></div>
      <Button variant="ghost" onClick={()=>setPage('agent')}>Back</Button></>}
    {page==='connect'&&<ConnectSetup onContinue={onContinue}/>}
  </div>;
}

function ConnectSetup({onContinue}:{onContinue:()=>Promise<void>}) {
  const {view,result,busy,request,attempted,browserFailed}=useConnectFlow(bridge);
  const [leaving,setLeaving]=useState(false);
  const advanced=useRef(false);
  const phase=view?.phase;
  useEffect(()=>{
    if(advanced.current||busy||!view)return;
    if(phase==='connected'||(leaving&&view.localReady)){
      advanced.current=true;void onContinue();
    }
  },[phase,busy,leaving,view?.localReady,onContinue]);
  async function local(){const receipt=await request('disable');if(receipt?.status==='connected')setLeaving(true);}
  const waiting=phase==='starting'||phase==='approval'||phase==='cancelling';
  const unavailable=result.status!=='connected'||!phase;
  return <><h1>{phase==='waitlisted'?'Ur spot is saved.':waiting?'Finish in ur browser.':'Meet in the cloud.'}</h1>
    <img className="native-connect-art" src={cloudAgent} alt="Computer floating among clouds"/>
    {phase==='waitlisted'?<><p>You’re on the Connect waitlist. <strong className="native-brand-name">apparent</strong> still works on this computer.</p><Button disabled={busy||leaving} onClick={()=>void local()}>Continue locally</Button></>:
      <><p>Connect <strong className="native-brand-name">apparent</strong>. Give ur agent a link.</p>
      {!waiting&&<><p className="native-connect-disclosure">Continuing requests upload access for new captures, including screen images, voice, transcript and context. Older captures stay local. Approve this computer in ur browser.</p>
        <Button disabled={busy||leaving||unavailable} onClick={()=>void request('connect')}>Continue with Google</Button></>}
      {phase==='approval'&&browserFailed&&<Button disabled={busy||leaving} onClick={()=>void request('open-browser')}>Try opening browser</Button>}
      {phase==='failed'&&<p role="alert">{view?.detail}</p>}
      {unavailable&&!busy&&<p role="alert">Connect is unavailable. You can still set up locally.</p>}
      <Button variant="ghost" disabled={busy||leaving||phase==='cancelling'||unavailable&&attempted} onClick={()=>{
        if(unavailable){bridge.close?.();void onContinue();}else void local();
      }}>Keep it local</Button></>}
    {phase==='cancelling'&&<p role="status">Turning uploads off before continuing…</p>}
    {(leaving&&phase==='failed'&&!view?.localReady||unavailable&&attempted)&&<Button disabled={busy} onClick={()=>void local()}>Retry cancellation</Button>}
  </>;
}
