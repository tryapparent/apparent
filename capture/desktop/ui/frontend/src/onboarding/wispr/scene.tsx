import {useEffect,useId,useRef} from 'react';
import sprites from './frog-sprites.png';
import {dunkDuration,dunkFrame} from './motion';
import type {WisprPhase} from './use-wispr';

export function WisprScene({phase,onLanded}:{phase:WisprPhase;onLanded:()=>void}){
  const root=useRef<HTMLDivElement>(null),landed=useRef(onLanded),pattern=useId();
  landed.current=onLanded;
  useEffect(()=>{
    const element=root.current!;
    const resize=()=>element.style.setProperty('--wispr-scale',String(Math.min(1,element.clientWidth/420)));
    const observer=new ResizeObserver(resize);observer.observe(element);resize();return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    const element=root.current!,frog=element.querySelector<HTMLElement>('.wispr-frog')!,tile=element.querySelector<HTMLElement>('.wispr-tile')!;
    const basket=element.querySelector<HTMLElement>('.wispr-basket')!,rim=element.querySelector<SVGElement>('.wispr-front-rim')!,spark=element.querySelector<SVGElement>('.wispr-spark')!;
    let active=true,frame=0;
    const paint=(time:number)=>{const value=dunkFrame(time);frog.dataset.pose=String(value.pose);frog.style.transform=value.frog;
      tile.style.transform=value.tile;tile.style.opacity=String(value.opacity);basket.style.transform=rim.style.transform=`rotate(${value.impact}deg)`;spark.style.opacity=value.spark?'1':'0';};
    paint(phase==='confirmed'?dunkDuration:0);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const finish=()=>{if(!active)return;active=false;cancelAnimationFrame(frame);paint(dunkDuration);landed.current();};
    const changed=()=>{if(reduced.matches&&phase==='dunking')finish();};
    reduced.addEventListener('change',changed);
    if(phase==='dunking')void (async()=>{
      if(reduced.matches){finish();return;}
      try{await Promise.all([element.querySelector('img')!.decode(),document.fonts.ready]);}catch{finish();return;}
      if(!active)return;
      let start:number|undefined;
      const tick=(now:number)=>{if(!active)return;start??=now;const time=Math.min(dunkDuration,now-start);paint(time);
        if(time<dunkDuration)frame=requestAnimationFrame(tick);else finish();};
      frame=requestAnimationFrame(tick);
    })();
    return()=>{active=false;cancelAnimationFrame(frame);reduced.removeEventListener('change',changed);};
  },[phase]);
  return <div ref={root} className="wispr-art" role="img" aria-label={phase==='dunking'||phase==='confirmed'?'The frog dunks a shortcut key to confirm Wispr Flow has closed.':'A frog waits, ready to dunk a shortcut key.'}>
    <div className="wispr-court" aria-hidden="true">
      <div className="wispr-basket"><svg viewBox="0 0 120 160" fill="none"><defs><pattern id={pattern} width="22" height="22" patternUnits="userSpaceOnUse"><path d="M-11 0 11 22 33 0M-11 22 11 0 33 22" stroke="var(--apparent-carbon)" strokeWidth="3"/></pattern></defs><path d="m12 28 13 118h70l13-118" fill="var(--apparent-stock)" stroke="var(--apparent-carbon)" strokeWidth="5"/><path d="m15 30 12 112h66l12-112" fill={`url(#${pattern})`}/><path d="M24 147h72v6H24z" fill="var(--apparent-carbon)"/><ellipse cx="60" cy="27" rx="54" ry="17" fill="var(--apparent-lilac)" stroke="var(--apparent-carbon)" strokeWidth="5"/><ellipse cx="60" cy="26" rx="43" ry="10" fill="var(--apparent-carbon)"/></svg></div>
      <div className="wispr-frog" data-pose="0"><img src={sprites} alt="" draggable={false}/></div>
      <div className="wispr-tile"><svg viewBox="0 0 48 48"><path d="M6 5h32l6 7v30H6L2 35V10z" fill="var(--apparent-stock)" stroke="var(--apparent-carbon)" strokeWidth="3"/><path d="M7 6h29v28H7z" fill="var(--apparent-paper)" stroke="var(--apparent-carbon)" strokeWidth="3"/><path d="m36 6 7 7v29l-7-8" stroke="var(--apparent-carbon)" strokeWidth="3"/></svg></div>
      <svg className="wispr-front-rim" viewBox="0 0 120 160"><path d="M6 27c0 22 108 22 108 0" fill="none" stroke="var(--apparent-carbon)" strokeWidth="10"/><path d="M6 27c0 22 108 22 108 0" fill="none" stroke="var(--apparent-lilac)" strokeWidth="5"/></svg>
      <svg className="wispr-spark" viewBox="0 0 70 70"><path d="m8 8 12 12m32-12L40 20m12 32L40 40M8 52l12-12M30 0v15m0 45v-15M0 30h15m45 0H45" stroke="var(--apparent-lilac)" strokeWidth="5"/></svg>
    </div>
  </div>;
}
