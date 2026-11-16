import {useEffect,useRef,useState} from 'react';
import type {WisprResult} from '../../../electron/onboarding/wispr';
import {confirmationHold} from './motion';
export type WisprPhase='checking'|'running'|'quitting'|'dunking'|'confirmed'|'error'|'bypass';
export type WisprRequest=(operation:'read'|'quit')=>Promise<WisprResult>;
export function useWisprFlow(eligible:boolean,request:WisprRequest|undefined){
  const [phase,setPhase]=useState<WisprPhase>('checking');
  const [unknown,setUnknown]=useState(false);
  const revision=useRef(0),pending=useRef(false),hold=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    const run=++revision.current;pending.current=false;setPhase('checking');
    if(eligible){
      pending.current=true;
      void Promise.resolve().then(()=>request?.('read')??{status:'disabled'}).catch(()=>({status:'unknown'})).then(result=>{
        if(run!==revision.current)return;
        pending.current=false;
        setUnknown(result.status==='unknown');
        setPhase(result.status==='running'?'running':result.status==='unknown'||result.status==='refused'?'error':'bypass');
      });
    }
    return()=>{revision.current++;pending.current=false;if(hold.current)clearTimeout(hold.current);};
  },[eligible,request]);
  async function quit(){
    if(!eligible||pending.current||!['running','error'].includes(phase))return;
    pending.current=true;const run=revision.current;setPhase('quitting');
    let result:WisprResult;
    try{result=await request?.('quit')??{status:'disabled'};}catch{result={status:'unknown'};}
    if(run!==revision.current)return;
    pending.current=false;setUnknown(result.status==='unknown');
    setPhase(result.status==='closed'?'dunking':result.status==='disabled'?'bypass':'error');
  }
  function skip(){revision.current++;pending.current=false;if(hold.current)clearTimeout(hold.current);setPhase('bypass');}
  function landed(){
    if(phase!=='dunking')return;
    setPhase('confirmed');const run=revision.current;
    hold.current=setTimeout(()=>{if(run===revision.current)setPhase('bypass');},confirmationHold);
  }
  return {visible:eligible&&phase!=='bypass',phase,unknown,quit,skip,landed};
}
