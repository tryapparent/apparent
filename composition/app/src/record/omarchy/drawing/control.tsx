import * as React from 'react';
import { Button } from '@apparent/ui/button';
import type { DrawingRendererPort, DrawingSnapshot, DrawingIntent } from './wire.ts';
export function DrawingControl({drawing}:{drawing?:DrawingRendererPort}){
  const [state,setState]=React.useState<DrawingSnapshot>();
  const [pending,setPending]=React.useState(false),[message,setMessage]=React.useState('');
  const read=async()=>{if(!drawing)return;try{setState(await drawing.read());}catch{setMessage('Drawing status is unknown.');}};
  React.useEffect(()=>{void read();},[drawing]);
  if(!drawing)return null;
  const act=async(intent:DrawingIntent)=>{
    if(pending||state?.phase!=='ready'||!state.captureRequestId)return;
    setPending(true);
    try{const outcome=await drawing.act({intent,captureRequestId:state.captureRequestId,revision:state.revision});
      setMessage(outcome==='outcome-unknown'?'Drawing control outcome is unknown.':outcome==='refused'?'Drawing control was refused.':'Drawing control requested.');await read();
    }catch{setMessage('Drawing control outcome is unknown.');}finally{setPending(false);}
  };
  return <section aria-label="Drawing controls">
    <p>When drawing input is ready during recording, hold Shift to draw on screen. Use the Apparent tray menu to open, undo, clear or close Board. Reopening Board keeps completed marks.</p>
    <Button variant="outline" disabled={pending} onClick={()=>void read()}>Check drawing status</Button>
    {state?.phase==='ready'&&(['open','undo','clear','close'] as const).map(intent=><Button key={intent} disabled={pending} onClick={()=>void act(intent)}>{intent==='open'?'Open Board':intent==='close'?'Close Board':intent==='undo'?'Undo drawing':'Clear drawing'}</Button>)}
    {state?.phase==='preparing'&&<p role="status">Preparing drawing input…</p>}
    {state?.phase==='draining'&&<p role="status">Finishing drawing input…</p>}
    {state?.phase==='unavailable'&&<p role="status">Drawing input is unavailable. The recording status below remains authoritative.</p>}
    {state?.phase==='complete'&&<p role="status">Drawing input finished. Check the Saved output for recorded content.</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
