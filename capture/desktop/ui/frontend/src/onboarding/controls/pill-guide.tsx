import {useLayoutEffect,useRef,useState} from 'react';
import {PillSurface} from '../../pill/pill-view';
type PillView = React.ComponentProps<typeof PillSurface>['view'];
import './pill-guide.css';

export function PillGuide({finish=false,onTarget}:{finish?:boolean;onTarget?:()=>void}) {
  const host=useRef<HTMLDivElement>(null),surface=useRef<HTMLDivElement>(null);
  const [layout,setLayout]=useState({width:500,scale:1,height:88,x:100,y:20});
  const target=finish?'finish':'whiteboard';
  const view:PillView={revision:1,phase:'recording',clock:'',label:'',warning:null,notice:null,reducedMotion:false,draggable:false,noteCount:0,inputWaveform:null,actions:[{id:'whiteboard',label:'Whiteboard',enabled:!onTarget||target==='whiteboard',selected:false,primary:false},{id:'finish',label:'Finish',enabled:!onTarget||target==='finish',selected:false,primary:true},{id:'cancel',label:'Cancel recording',enabled:!onTarget,selected:false,primary:false}]};
  const description = finish
    ? 'Example: click the stop square to save your capture'
    : 'Example: click the pen icon to open Whiteboard';
  useLayoutEffect(()=>{
    const update=()=>{if(!host.current||!surface.current)return;
      const pill=surface.current.querySelector<HTMLElement>('.pill'),button=surface.current.querySelector<HTMLElement>(`[data-action=${target}]`);
      if(!pill||!button)return;
      // The native window reserves transparent space for its notes extension.
      // Fit the visible row, not that native-window reservation, inside the coach.
      const width=pill.querySelector<HTMLElement>('.pill-row')?.offsetWidth??pill.offsetWidth,scale=Math.min(1,host.current.clientWidth/width);
      const rect=button.getBoundingClientRect(),origin=surface.current.getBoundingClientRect();
      const current=surface.current.offsetWidth?parseFloat(surface.current.style.getPropertyValue('--preview-scale'))||1:1;
      setLayout({width,scale,height:Math.ceil(pill.offsetHeight*scale)+12,x:(rect.left-origin.left+rect.width/2)/current*scale,y:(rect.top-origin.top+rect.height/2)/current*scale});
    };
    update();const observer=new ResizeObserver(update);if(host.current)observer.observe(host.current);if(surface.current)observer.observe(surface.current);
    void document.fonts.ready.then(update);return()=>observer.disconnect();
  },[target]);
  return <figure className="native-control native-pill-guide" style={{'--pill-preview-width':`${layout.width}px`} as React.CSSProperties} data-kind={finish?"finish":"whiteboard"} aria-label={onTarget ? undefined : description}>
    <div ref={host} className="native-pill-example" style={{height:layout.height}}>
      <div ref={surface} inert={!onTarget} aria-hidden={!onTarget || undefined} className="native-pill-example-surface" style={{'--preview-scale':layout.scale} as React.CSSProperties}>
        <PillSurface view={view} receivedAt={performance.now()} onAction={id=>{if(id===target)onTarget?.()}}/>
      </div>
      <svg className="native-pill-pointer" aria-hidden="true" viewBox="0 0 22 26" style={{'--target-x':`${layout.x}px`,'--target-y':`${layout.y}px`} as React.CSSProperties}><path d="M1 1V19L6 14 11 23 14 21 9 12H17Z"/></svg>
    </div>
  </figure>;
}
