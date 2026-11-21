import {useLayoutEffect,useRef,useState} from 'react';
import {PillSurface} from '../../pill/pill-view';
type PillView = React.ComponentProps<typeof PillSurface>['view'];
import './pill-guide.css';

/** Inert examples use the production pill's markup, icons, spacing and theme. */
export function PillGuide({screenOnly=false,finish=false}:{screenOnly?:boolean;finish?:boolean}) {
  const host=useRef<HTMLDivElement>(null),surface=useRef<HTMLDivElement>(null);
  const [layout,setLayout]=useState({width:500,scale:1,height:88,x:100,y:20});
  const target=screenOnly?'select-screen':finish?'finish':'whiteboard';
  const view:PillView={revision:1,phase:screenOnly?'selecting':'recording',clock:'0:03',label:'Choose what to record',warning:null,notice:null,reducedMotion:false,draggable:false,noteCount:0,inputWaveform:screenOnly?null:Array(24).fill(.08),actions:screenOnly?
    [{id:'select-area',label:'Area',enabled:true,selected:false,primary:false},{id:'select-screen',label:'Screen',enabled:true,selected:false,primary:false}]:
    [{id:'whiteboard',label:'Whiteboard',enabled:true,selected:false,primary:false},{id:'finish',label:'Finish',enabled:true,selected:false,primary:true},{id:'cancel',label:'Cancel recording',enabled:true,selected:false,primary:false}]};
  useLayoutEffect(()=>{
    const update=()=>{if(!host.current||!surface.current)return;
      const pill=surface.current.querySelector<HTMLElement>('.pill'),button=surface.current.querySelector<HTMLElement>(`[data-action=${target}]`);
      if(!pill||!button)return;
      // The native window reserves transparent space for its notes extension.
      // Fit the visible row, not that native-window reservation, inside the coach.
      const width=pill.querySelector<HTMLElement>('.pill-row')?.offsetWidth??pill.offsetWidth,scale=Math.min(1,host.current.clientWidth/width);
      const rect=button.getBoundingClientRect(),origin=surface.current.getBoundingClientRect();
      const current=surface.current.offsetWidth?parseFloat(surface.current.style.getPropertyValue('--preview-scale'))||1:1;
      setLayout({width,scale,height:Math.ceil(pill.offsetHeight*scale)+24,x:(rect.left-origin.left+rect.width/2)/current*scale,y:(rect.top-origin.top+rect.height/2)/current*scale});
    };
    update();const observer=new ResizeObserver(update);if(host.current)observer.observe(host.current);if(surface.current)observer.observe(surface.current);
    void document.fonts.ready.then(update);return()=>observer.disconnect();
  },[target]);
  return <figure className="native-control native-pill-guide" style={{'--pill-preview-width':`${layout.width}px`} as React.CSSProperties} data-kind={finish?"finish":"whiteboard"} aria-label={`Example: click ${screenOnly?'Screen':finish?'Finish':'Whiteboard'} in the recording controls`}>
    <div ref={host} className="native-pill-example" style={{height:layout.height}}>
      <div ref={surface} inert aria-hidden="true" className="native-pill-example-surface" style={{'--preview-scale':layout.scale} as React.CSSProperties}>
        <PillSurface view={view} receivedAt={performance.now()} onAction={()=>{}}/>
      </div>
      <svg className="native-pill-pointer" aria-hidden="true" viewBox="0 0 22 26" style={{'--target-x':`${layout.x}px`,'--target-y':`${layout.y}px`} as React.CSSProperties}><path d="M1 1V19L6 14 11 23 14 21 9 12H17Z"/></svg>
    </div>
  </figure>;
}
