import {Button} from '@apparent/ui/button';
import {useEffect,useRef} from 'react';
import {WisprScene} from './scene';
import type {useWisprFlow} from './use-wispr';
import './wispr.css';

export function WisprStep({flow}:{flow:ReturnType<typeof useWisprFlow>}){
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  const success=flow.phase==='dunking'||flow.phase==='confirmed',error=flow.phase==='error';
  const busy=['checking','quitting','dunking','confirmed'].includes(flow.phase);
  return <div className="native-wispr" aria-busy={flow.phase==='checking'||flow.phase==='quitting'}>
    <WisprScene phase={flow.phase} onLanded={flow.landed}/>
    <h1 ref={heading} tabIndex={-1}>{success?'All yours.':error?(flow.unknown?'Couldn’t check Wispr.':'Wispr is still open.'):'Wispr, take five.'}</h1>
    <p role={error?'alert':'status'} aria-live="polite">{success?'Wispr Flow has quit.':error?(flow.unknown?'Quit it from its menu, then try again.':'Finish any dictation, then try again.'):flow.phase==='checking'?'Checking Wispr Flow…':flow.phase==='quitting'?'Waiting for Wispr Flow to close.':<>Avoid shortcut clashes.<br/>Wispr stays installed.</>}</p>
    <div className="native-wispr-actions">
      <Button disabled={busy} onClick={()=>void flow.quit()}>{error?'Try again':'Quit Wispr Flow'}</Button>
      <Button variant="ghost" disabled={flow.phase==='quitting'} onClick={flow.skip}>{success?(flow.phase==='confirmed'?'Continue':'Skip animation'):error?'Continue anyway':'Keep it open'}</Button>
    </div>
  </div>;
}
