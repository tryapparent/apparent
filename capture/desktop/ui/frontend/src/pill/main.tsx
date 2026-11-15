import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from '@apparent/ui/button';
import {StatusCard} from '@apparent/ui/status-card';
import type {PillView} from './bridge';
import './style.css';
import {DestinationPicker} from './destination-picker';
import type {DestinationView} from './destinations';
import './destination-picker.css';
import {PillSurface} from './pill-view';


function Pill() {
  const [view,setView]=useState<PillView|null>(null);
  const [destination,setDestination]=useState<DestinationView|null>(null);
  useEffect(()=>{
    const bridge=window.apparentPill;if(!bridge)return;
    const unsubscribe=bridge.subscribeDestinations(setDestination);
    void bridge.destinations().then(setDestination).catch(()=>{});return unsubscribe;
  },[]);
  const [receivedAt,setReceivedAt]=useState(0);
  const [systemReduced,setSystemReduced]=useState(false);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setSystemReduced(media.matches);update();
    media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[]);
  const [sharing,setSharing]=useState<number|null>(null);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState(false);
  const current=useRef<PillView|null>(null);
  const busy=useRef(false);
  useEffect(()=>{
    const bridge=window.apparentPill;
    if(!bridge){setError(true);return;}
    let active=true;
    const apply=(next:PillView|null)=>{
      if(!active || !next || current.current && next.revision<current.current.revision)return;
      if(next.revision!==current.current?.revision){busy.current=false;setPending(false);setError(false);setSharing(null);}
      current.current=next;setReceivedAt(performance.now());setView(next);
    };
    const unsubscribe=bridge.subscribe(apply);
    void bridge.read().then(apply).catch(()=>{if(active)setError(true);});
    return ()=>{active=false;unsubscribe();};
  },[]);
  useLayoutEffect(()=>{
    if(!view)return;
    let active=true,last='';
    const report=()=>{
      if(!active)return;
      const rect=document.querySelector('main')?.getBoundingClientRect();
      const key=JSON.stringify([rect?.width,rect?.height]);
      if(key===last)return;
      last=key;void window.apparentPill?.layout(view.revision).catch(()=>{});
    };
    // Only semantic changes or an actual size change need a native layout pass.
    // Clock/meter snapshots retain their revision and never enter this effect.
    report();
    const observer=new ResizeObserver(report),element=document.querySelector('main');
    if(element)observer.observe(element);
    void document.fonts.ready.then(report);
    return()=>{active=false;observer.disconnect();};
  },[view?.revision,view?.phase]);
  async function act(action:string,drop=false){
    const before=current.current;
    if(!before || busy.current)return;
    busy.current=true;setPending(true);setError(false);
    try{const result=await window.apparentPill!.act(before.revision,action,drop);if((result?.cancelled||result?.confirmationRequired)&&current.current?.revision===before.revision){busy.current=false;setPending(false);setSharing(result.confirmationRequired?before.revision:null);}}
    catch{if(current.current?.revision===before.revision){busy.current=false;setPending(false);setError(true);}}
    // Successful dispatch unlocks on authoritative readback. Refusals allow a manual retry; never retry a mutation automatically.
  }
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&sharing!==null){event.preventDefault();void act('cancel-public-link');return;}
      if(event.key==='Escape' && view?.actions.some(a=>a.id==='cancel' && a.enabled)){
        event.preventDefault();void act('cancel');
      }
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[view,sharing]);
  if(!view)return <div role="status" className="pill connection">{error?'Recording controls unavailable':'Connecting…'}</div>;
  if(view.phase==='hidden')return null;
  if(destination && ['processing','completed'].includes(view.phase))return <main data-revision={view.revision} className="pill apparent-theme" data-phase={view.phase} data-reduced={view.reducedMotion}>
    <DestinationPicker key={destination.capture} view={destination}/>
  </main>;
  return <PillSurface view={view} pending={pending} controlsDisabled={sharing!==null} error={error} receivedAt={receivedAt} reduced={systemReduced} manualDrag={window.apparentPill?.manualDrag} onAction={(id,drop)=>void act(id,drop)} onBeginDrag={()=>window.apparentPill!.beginDrag(view.revision)} onBeginPaste={()=>window.apparentPill!.beginPaste(view.revision)} onCancelPaste={()=>void window.apparentPill?.cancelPaste()}>
    {sharing===view.revision&&<section className="public-share-confirmation" aria-label="Confirm public sharing"><StatusCard tone="neutral" headline="Create a public link?" compact>
      <p>Anyone with this link can view this capture. Shared captures are not end-to-end encrypted.</p>
      <div className="public-share-actions"><Button variant="outline" disabled={pending} onClick={()=>void act('cancel-public-link')}>Cancel sharing</Button><Button disabled={pending} onClick={()=>void act('confirm-public-link')}>Create public link</Button></div>
    </StatusCard></section>}
  </PillSurface>;
}

createRoot(document.getElementById('root')!).render(<Pill/>);
