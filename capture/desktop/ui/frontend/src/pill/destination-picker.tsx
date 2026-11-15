import {useEffect,useRef,useState} from 'react';
import {Button} from '@apparent/ui/button';
import {StatusCard} from '@apparent/ui/status-card';
import {Check,ChevronDown,Clock,LoaderCircle,MessageSquare,PauseCircle,Pin,X} from 'lucide-react';
import {visibleDestinations,type DestinationView} from './destinations';
const icons={new:MessageSquare,pinned:Pin,working:Clock,active:MessageSquare,snoozed:PauseCircle};
export function DestinationPicker({view}:{view:DestinationView}){
 const [open,setOpen]=useState(false),[index,setIndex]=useState(0),[error,setError]=useState(''),[copied,setCopied]=useState(false),[busy,setBusy]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null),pending=useRef(false),touchY=useRef(0);
 const focused=useRef(false);
 useEffect(()=>{if(!focused.current&&view.choices.length&&view.phase==='choosing'){
  focused.current=true;void window.apparentPill?.destinationFocus(true).then(()=>trigger.current?.focus({preventScroll:true})).catch(()=>{});
 }},[view.choices.length,view.phase]);
 const committed=Math.max(0,view.choices.findIndex(c=>c.id===view.selected));
 const selected=!open&&view.confirmed?view.confirmed:view.choices[open?Math.min(index,view.choices.length-1):committed];
 const canChoose=view.phase==='choosing'||view.phase==='error'&&!view.selected;
 const {start,rows}=visibleDestinations(view.choices,index),progress=view.processing||view.phase==='sending';
 async function action(action:'choose'|'retry'|'cancel'|'dismiss'|'copy'|'setup',id?:string){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setCopied(false);
  try{await window.apparentPill!.destinationAction(view.capture,action,id);if(action==='copy')setCopied(true);setOpen(false);void window.apparentPill?.destinationFocus(false);}
  catch{setError('Action not confirmed. Try again or copy the recording.');}finally{pending.current=false;setBusy(false);}
 }
 function expand(){if(!canChoose||view.choices.length<2)return;setIndex(Math.max(1,committed));setOpen(true);void window.apparentPill?.destinationFocus(true);trigger.current?.focus({preventScroll:true});}
 function move(delta:number){const next=Math.max(0,Math.min(view.choices.length-1,index+delta));setIndex(next);setOpen(next!==0);}
 function key(event:React.KeyboardEvent){
  if((event.target as HTMLElement).closest('.destination-notification'))return;
  if(['ArrowDown','ArrowUp','Home','End','Escape'].includes(event.key))event.preventDefault();
  if(event.key==='Escape'){setOpen(false);setIndex(committed);void window.apparentPill?.destinationFocus(false);}
  else if(canChoose&&(event.key==='ArrowDown'||event.key==='ArrowUp')){if(!open)expand();else move(event.key==='ArrowDown'?1:-1);}
  else if(open&&event.key==='Home')setIndex(1);else if(open&&event.key==='End')setIndex(view.choices.length-1);
  else if(event.key==='Enter'&&event.target===trigger.current){event.preventDefault();if(selected&&canChoose)void action('choose',selected.id);}
 }
 const status=progress?'Processing recording':view.phase==='sent'?'Submitted':'Recording saved';
 const failure=view.phase==='error'||view.phase==='uncertain'||error;
 return <div className="destination-stack" data-open={open} aria-busy={busy} onKeyDown={key}>
  <div className="destination-assembly"><div className="destination-pill">
   <span className="destination-status" role={progress?'progressbar':'img'} aria-label={status}>{progress?<LoaderCircle className="destination-spinner" aria-hidden="true"/>:<Check aria-hidden="true"/>}</span>
   {view.phase==='setup'?<Button className="destination-trigger" onClick={()=>void action('setup')}>Connect T3</Button>:<>
   <Button ref={trigger} variant="secondary" className="destination-trigger" role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls="destination-options" aria-activedescendant={open?`destination-option-${index}`:undefined}
    aria-label={`${selected?.title??'New thread'}, recording destination${selected?.project?', '+selected.project:''}`} title={selected?`${selected.title} · ${selected.project}`:'Loading T3 destinations'} disabled={!canChoose||busy||!selected}
    onClick={()=>{if(open){setOpen(false);setIndex(committed);}else expand();}}><span>{selected?.title??'New thread'}</span><ChevronDown aria-hidden="true"/></Button>
   </>}
   <Button variant="ghost" size="icon" className="destination-close" aria-label="Close; keep recording and confirmed handoff" onClick={()=>void window.apparentPill?.destinationAction(view.capture,'dismiss').catch(()=>setError('Unable to close. Try again.'))}><X aria-hidden="true"/></Button>
  </div>
  {open&&<div className="destination-tray"><div id="destination-options" role="listbox" aria-label="Recording destination" onWheel={e=>{if(Math.abs(e.deltaY)>2)move(e.deltaY>0?1:-1)}} onTouchStart={e=>touchY.current=e.touches[0]?.clientY??0} onTouchEnd={e=>{const delta=touchY.current-(e.changedTouches[0]?.clientY??0);if(Math.abs(delta)>20)move(delta>0?1:-1)}}>
   {rows.map((choice,j)=>{const i=start+j,Icon=icons[choice.kind];return <Button key={choice.id} id={`destination-option-${i}`} role="option" disabled={busy} tabIndex={-1} variant="ghost" className="destination-option" data-continuation={j===2&&i<view.choices.length-1&&i!==index} aria-selected={i===index} aria-label={`${choice.title}, ${choice.project}, ${choice.kind}`} title={`${choice.title} · ${choice.project}`} onClick={()=>void action('choose',choice.id)}><Icon aria-hidden="true"/><span>{choice.title}</span></Button>})}
  </div></div>}
  </div>
  {view.phase==='setup'?<div className="destination-notification"><StatusCard tone="neutral" headline="Connect T3 to show your threads" compact><p>Sending is on. Finish connecting in Settings → Agents.</p><div className="destination-recovery"><Button variant="outline" disabled={busy} onClick={()=>void action('retry')}>Check connection</Button><Button variant="outline" disabled={busy||view.processing} onClick={()=>void action('copy')}>{copied?'Copied':'Copy instead'}</Button></div></StatusCard></div>:failure?<div className="destination-notification"><StatusCard tone="failure" headline={view.phase==='uncertain'?'Delivery not confirmed':'Couldn’t submit'} compact><p>{error||view.error||'Recording kept. Try again or copy it.'}</p><div className="destination-recovery"><Button variant="outline" disabled={busy} onClick={()=>void action('retry')}>Retry</Button><Button variant="outline" disabled={busy||view.processing} onClick={()=>void action('copy')}><span role={copied?'status':undefined}>{copied?'Copied':'Copy instead'}</span></Button></div></StatusCard></div>:
   view.phase==='armed'?<div className="destination-notification destination-receipt" role="status">Will submit when ready<Button variant="ghost" disabled={busy} onClick={()=>void action('cancel')}>Cancel handoff</Button></div>:null}
 </div>;
}
