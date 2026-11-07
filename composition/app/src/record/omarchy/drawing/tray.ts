import type { RecordClient } from '@apparent/record/capabilities';
import type { DrawingHostPort, DrawingIntent, DrawingSnapshot } from './wire.ts';
export interface DrawingMenuItem {label:string;enabled:boolean;click():void}
/** Stock tray menu borrowing the existing Stop owner. No native RPC. */
export function bindDrawingTray(options:{record:RecordClient;drawing?:DrawingHostPort;stop():void;menu(items:DrawingMenuItem[]):void;notice(text:string):void}){
  let current:DrawingSnapshot|undefined,activeId:string|undefined,canStop=false,pending=false,disposed=false;
  const render=()=>{
    if(disposed)return;
    const ready=current?.captureRequestId===activeId&&!!activeId&&current?.phase==='ready'&&!pending;
    const act=(intent:DrawingIntent)=>()=>{
      if(!ready||!current?.captureRequestId||!options.drawing||pending||disposed)return;
      const action={intent,captureRequestId:current.captureRequestId,revision:current.revision};
      pending=true;render();
      void options.drawing.act(action).then(outcome=>{
        if(outcome==='outcome-unknown'&&!disposed)options.notice('Drawing control outcome unknown — activate to Stop recording');
      }).catch(()=>{if(!disposed)options.notice('Drawing control outcome unknown — activate to Stop recording');}).finally(()=>{pending=false;render();});
    };
    options.menu([
      {label:'Open Board',enabled:ready&&!current?.board?.open,click:act('open')},
      {label:'Undo drawing',enabled:ready&&!!current?.board?.open&&!!(current.board.strokeCount||current.board.activeGesture),click:act('undo')},
      {label:'Clear drawing',enabled:ready&&!!current?.board?.open,click:act('clear')},
      {label:'Close Board',enabled:ready&&!!current?.board?.open,click:act('close')},
      {label:'Stop recording',enabled:canStop,click:()=>{if(canStop&&!disposed)options.stop();}},
    ]);
  };
  const removeDrawing=options.drawing?.observe(value=>{current=value;
    options.notice(value.phase==='ready'?'Apparent — hold Shift to draw; menu for Board; activate to Stop recording':
      value.phase==='unavailable'?'Apparent — drawing unavailable; activate to Stop recording':'Apparent — activate to Stop recording');render();});
  const removeRecord=options.record.observe(value=>{
    const active=value.captures.filter(c=>['starting','recording','unknown'].includes(c.phase));
    activeId=active.length===1&&active[0].phase==='recording'?active[0].captureId:undefined;
    canStop=active.length===1;render();
  });
  return()=>{disposed=true;removeDrawing?.();removeRecord();};
}
