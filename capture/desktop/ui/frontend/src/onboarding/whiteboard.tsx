import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {Button} from '@apparent/ui/button';
import wordmark from '../../../../../../shared/assets/brand/apparent-wordmark.svg';
import './whiteboard.css';
export type BoardView={id:string;strokes:number[][][];color:number[]};
type Action={action:'board';id:string;operation:string;point?:number[]};
/** Only pointer input crosses the bridge. The example is a separate, inert SVG. */
export function Whiteboard({board,action}:{board:BoardView;action:(value:Action)=>Promise<void>}){
  const [run,setRun]=useState(0),[done,setDone]=useState(false),[draft,setDraft]=useState<number[][]>([]),[pending,setPending]=useState<{index:number;points:number[][]}[]>([]);
  useEffect(()=>{setPending(list=>list.filter(stroke=>stroke.index>=board.strokes.length))},[board.strokes.length]);
  const root=useRef<HTMLElement|null>(null);
  useEffect(()=>{root.current?.focus()},[]);
  const points=useRef<number[][]>([]),pointer=useRef<number|null>(null);
  useEffect(()=>{setDone(false);const timer=setTimeout(()=>setDone(true),window.matchMedia('(prefers-reduced-motion: reduce)').matches?1200:4200);return()=>clearTimeout(timer)},[run]);
  const send=(operation:string,ink?:number[])=>action({action:'board',id:board.id,operation,...(ink?{point:ink}:{})});
  const penStyle=({'217,76,68':'var(--apparent-pen-coral)','122,88,199':'var(--apparent-pen-purple)','59,121,189':'var(--apparent-pen-blue)','57,123,97':'var(--apparent-pen-green)'} as Record<string,string>)[board.color.join(',')]??'var(--apparent-carbon)';
  const cancelDraft=()=>{points.current=[];pointer.current=null;setDraft([]);setPending([]);};
  const finish=()=>{if(points.current.length){void send('end');const ink=points.current;setPending(list=>[...list,{index:board.strokes.length+list.filter(s=>s.index>=board.strokes.length).length,points:ink}]);points.current=[];setDraft([]);}pointer.current=null;};
  return <main ref={root} tabIndex={-1} className="native-board" style={{'--board-pen':penStyle} as CSSProperties} onKeyDown={event=>{if(event.key==='Escape'){finish();void send('close');}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();cancelDraft();void send('undo');}}}>
    <header><img src={wordmark} alt="apparent"/><span>Whiteboard</span><Button variant="outline" onClick={()=>{cancelDraft();void send('undo');}}>Undo</Button><Button variant="outline" onClick={()=>{cancelDraft();void send('clear');}}>Clear</Button><Button aria-label="Close whiteboard" onClick={()=>{finish();void send('close');}}>×</Button></header>
    <div className="native-board-paper">
      <svg aria-label="Whiteboard drawing canvas"
        onPointerDown={event=>{if(event.button!==0||pointer.current!==null)return;pointer.current=event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);const rect=event.currentTarget.getBoundingClientRect();points.current=[[event.clientX-rect.left,event.clientY-rect.top]];void send('begin',points.current[0]);setDraft([...points.current]);}}
        onPointerMove={event=>{if(pointer.current!==event.pointerId)return;const rect=event.currentTarget.getBoundingClientRect();points.current.push([Math.max(0,Math.min(1599,event.clientX-rect.left)),Math.max(0,Math.min(1099,event.clientY-rect.top))]);void send('move',points.current[points.current.length-1]);setDraft([...points.current]);}}
        onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
        {[...board.strokes,...pending.filter(stroke=>stroke.index>=board.strokes.length).map(stroke=>stroke.points),...(draft.length?[draft]:[])].map((stroke,index)=><polyline key={index} points={stroke.map(p=>p.join(',')).join(' ')} fill="none" stroke="var(--board-pen)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>)}
      </svg>
      <div className="native-board-lesson"><p role="status">{done?'Your turn.':'Watch this.'}</p>{!done&&<svg key={run} aria-hidden="true" viewBox="0 0 300 160"><path stroke="var(--board-pen)" pathLength="1" d="M34 105 C52 32 124 20 149 58 S102 142 82 101 S174 23 214 67 S240 144 184 116 Q139 93 252 44"/></svg>}</div>
      <Button variant="ghost" className="native-board-replay" onClick={()=>setRun(value=>value+1)}>Replay guide</Button>
    </div>
  </main>;
}
