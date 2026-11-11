import {useEffect,useRef,useState} from 'react';
import {stepMeter,type MeterState} from './meter-policy';

export function InputMeter({input,receivedAt,reduced}:{input:number;receivedAt:number;reduced:boolean}) {
  const [level,setLevel]=useState(0);
  const state=useRef<MeterState>({level:0,at:performance.now()});
  useEffect(()=>{
    const tick=()=>{state.current=stepMeter(state.current,input,receivedAt,performance.now(),reduced);setLevel(state.current.level);};
    tick();const timer=setInterval(tick,40);return()=>clearInterval(timer);
  },[input,receivedAt,reduced]);
  return <span className="meter" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level*100)} data-active={level>.01} data-reduced={reduced}>
    {[.55,.8,1,.75,.5].map((gain,index)=><i aria-hidden="true" key={index} style={{height:reduced?'10px':`${3+19*gain*level}px`}}/>)}
  </span>;
}
