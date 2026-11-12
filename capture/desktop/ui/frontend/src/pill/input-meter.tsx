import {useEffect,useState} from 'react';
import {waveformLevels,waveformHeight} from './meter-policy';

export function InputMeter({input,receivedAt,reduced}:{input:readonly number[];receivedAt:number;reduced:boolean}) {
  const [now,setNow]=useState(()=>performance.now());
  useEffect(()=>{
    setNow(performance.now());
    // One expiry only. A missing producer never scrolls synthetic history.
    const timer=setTimeout(()=>setNow(performance.now()),310);
    return()=>clearTimeout(timer);
  },[receivedAt]);
  const levels=waveformLevels(input,receivedAt,Math.max(now,receivedAt));
  const latest=levels.at(-1)??0;
  return <span className="meter" role="img" aria-label="Captured microphone waveform" data-active={latest>Math.pow(.002,.55)*1.15} data-reduced={reduced}>
    {levels.map((level,index)=><i aria-hidden="true" key={index} style={{height:`${waveformHeight(level,reduced)}px`,opacity:.35+.65*index/23}}/>)}
  </span>;
}
