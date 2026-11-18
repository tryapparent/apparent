import {useEffect, useRef, useState, type CSSProperties} from 'react';
import {Button} from '@apparent/ui/button';
import {BoardLesson} from '../../../../../../../onboarding/renderer/board-lesson';
import wordmark from '../../../../../../../shared/assets/brand/apparent-wordmark.svg';
import './whiteboard.css';
import { shouldClosePracticeBoard } from '../state';
export type BoardView={id:string;strokes:number[][][];color:number[]};
type Action={action:'board';id:string;operation:string;point?:number[]};
/** Only pointer input crosses the bridge. The example is a separate, inert SVG. */
export function Whiteboard({board,action}:{board:BoardView;action:(value:Action)=>Promise<void>}){
  const [draft,setDraft]=useState<number[][]>([]),[pending,setPending]=useState<{index:number;points:number[][]}[]>([]);
  useEffect(()=>{setPending(list=>list.filter(stroke=>stroke.index>=board.strokes.length))},[board.strokes.length]);
  const root=useRef<HTMLElement|null>(null);
  useEffect(()=>{root.current?.focus()},[]);
  const points=useRef<number[][]>([]),pointer=useRef<number|null>(null);
  const closing=useRef(false);
  useEffect(()=>{
    if(!closing.current&&pointer.current===null&&shouldClosePracticeBoard(board.strokes)){
      closing.current=true;
      void action({action:'board',id:board.id,operation:'close'}).catch(()=>{closing.current=false;});
    }
  },[board.strokes,board.id,action]);
  const send=(operation:string,ink?:number[])=>action({action:'board',id:board.id,operation,...(ink?{point:ink}:{})});
  const visiblePending=pending.filter(stroke=>stroke.index>=board.strokes.length);
  const penStyle=`#${board.color.map(channel=>channel.toString(16).padStart(2,'0')).join('')}`;
  const cancelDraft=(clearPending=false)=>{if(pointer.current!==null)void send('cancel');points.current=[];pointer.current=null;setDraft([]);if(clearPending)setPending([]);};
  const finish=()=>{if(points.current.length){void send('end');const ink=points.current;setPending(list=>[...list,{index:board.strokes.length+list.filter(s=>s.index>=board.strokes.length).length,points:ink}]);points.current=[];setDraft([]);}pointer.current=null;};
  useEffect(()=>()=>{if(pointer.current!==null)void send('cancel');},[]);
  return <main ref={root} tabIndex={-1} className="native-board" style={{'--board-pen':penStyle} as CSSProperties} onKeyDown={event=>{if(event.key==='Escape'){finish();void send('close');}if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();cancelDraft(true);void send('undo');}}}>
    <header><img src={wordmark} alt="apparent"/><span>Whiteboard</span><Button variant="outline" onClick={()=>{cancelDraft(true);void send('undo');}}>Undo</Button><Button variant="outline" onClick={()=>{cancelDraft(true);void send('clear');}}>Clear</Button><Button aria-label="Close whiteboard" onClick={()=>{finish();void send('close');}}>×</Button></header>
    <div className="native-board-paper">
      <svg aria-label="Whiteboard drawing canvas"
        onPointerDown={event=>{if(event.button!==0||pointer.current!==null)return;pointer.current=event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);const rect=event.currentTarget.getBoundingClientRect();points.current=[[event.clientX-rect.left,event.clientY-rect.top]];void send('begin',points.current[0]);setDraft([...points.current]);}}
        onPointerMove={event=>{if(pointer.current!==event.pointerId)return;const rect=event.currentTarget.getBoundingClientRect();points.current.push([Math.max(0,Math.min(1599,event.clientX-rect.left)),Math.max(0,Math.min(1099,event.clientY-rect.top))]);void send('move',points.current[points.current.length-1]);setDraft([...points.current]);}}
        onPointerUp={finish} onPointerCancel={()=>cancelDraft()} onLostPointerCapture={()=>{if(pointer.current!==null)cancelDraft();}}>
        {[...board.strokes,...visiblePending.map(stroke=>stroke.points),...(draft.length?[draft]:[])].map((stroke,index)=>stroke.length===1
          ? <circle key={index} cx={stroke[0][0]} cy={stroke[0][1]} r="1.5" fill="var(--board-pen)"/>
          : <polyline key={index} points={stroke.map(p=>p.join(',')).join(' ')} fill="none" stroke="var(--board-pen)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>)}
      </svg>
      <BoardLesson hasStroke={board.strokes.length>0||visiblePending.length>0} drawing={draft.length>0}/>
    </div>
  </main>;
}
