import { randomUUID } from 'node:crypto';
import type { CapabilitySnapshot, RecordClient } from '@apparent/record/capabilities';
import type { DrawingHostPort, DrawingIntent, DrawingSnapshot } from './wire.ts';
export interface DrawingMenuItem {label:string;enabled:boolean;click():void}
/** Stock tray menu borrowing the existing Stop owner. No native RPC. */
export function bindDrawingTray(options:{record:RecordClient;drawing?:DrawingHostPort;stop():void;menu(items:DrawingMenuItem[]):void;notice(text:string):void;createRequestId?():string}){
  let current:DrawingSnapshot|undefined,activeId:string|undefined,canStop=false,pending=false,disposed=false;
  let snapshot:CapabilitySnapshot|undefined;
  let cancellation:{captureId:string;providerEpoch:string;phase:'pending'|'awaiting-observation'|'outcome-unknown'}|undefined;
  let cancelFeedback:'refused'|'cancelled'|undefined;
  let feedbackCaptureId:string|undefined;
  const cancelTarget=()=>{
    const active=snapshot?.captures.filter(c=>['starting','recording','unknown'].includes(c.phase))??[];
    return snapshot?.connection==='connected'&&active.length===1&&['starting','recording'].includes(active[0].phase)
      ?{captureId:active[0].captureId,expected:{providerEpoch:snapshot.providerEpoch,revision:snapshot.revision}}:undefined;
  };
  const notice=()=>options.notice(cancellation
    ?cancellation.phase==='outcome-unknown'?'Apparent — cancellation outcome unknown; activate to Stop or inspect recording':'Apparent — cancellation requested; awaiting recording status'
    :cancelFeedback==='cancelled'?'Apparent — recording cancelled'
    :cancelFeedback==='refused'?'Apparent — cancellation refused; activate to Stop or inspect recording'
    :current?.phase==='ready'?'Apparent — hold Shift to draw; menu for Board; activate to Stop recording'
    :current?.phase==='unavailable'?'Apparent — drawing unavailable; activate to Stop recording':'Apparent — activate to Stop recording');
  const render=()=>{
    if(disposed)return;
    notice();
    const ready=current?.captureRequestId===activeId&&!!activeId&&current?.phase==='ready'&&!pending;
    const target=cancelTarget();
    const cancellationStatus=cancellation
      ?cancellation.phase==='outcome-unknown'?'Cancellation outcome unknown':'Cancellation requested — awaiting recording status'
      :cancelFeedback==='cancelled'?'Recording cancelled':cancelFeedback==='refused'?'Cancellation refused':undefined;
    const cancel=()=>{
      // A menu opened for an older request/revision must never retarget a new capture.
      const live=cancelTarget();
      if(disposed||cancellation||!target||!live||live.captureId!==target.captureId
        ||live.expected.providerEpoch!==target.expected.providerEpoch||live.expected.revision!==target.expected.revision)return;
      const attempt={captureId:target.captureId,providerEpoch:target.expected.providerEpoch,phase:'pending' as const};
      cancellation=attempt;cancelFeedback=undefined;feedbackCaptureId=target.captureId;render();
      const unknown=()=>{if(!disposed&&cancellation===attempt){cancellation.phase='outcome-unknown';render();}};
      try{const requestId=(options.createRequestId??randomUUID)();
        void options.record.execute({type:'cancel-capture',...target,requestId}).then(result=>{
        if(disposed||cancellation!==attempt)return;
        if(snapshot?.providerEpoch!==attempt.providerEpoch||result.requestId!==requestId
          ||result.snapshot.providerEpoch!==attempt.providerEpoch){unknown();return;}
        if(result.status==='refused'){cancellation=undefined;cancelFeedback='refused';}
        else cancellation.phase=result.status==='outcome-unknown'?'outcome-unknown':'awaiting-observation';
        // A command receipt alone is never an observed cancelled capture or new Saved.
        render();
      }).catch(unknown);}catch{unknown();}
    };
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
      {label:'Cancel recording',enabled:!!target&&!cancellation,click:cancel},
      ...(cancellationStatus?[{label:cancellationStatus,enabled:false,click(){}}]:[]),
    ]);
  };
  const removeDrawing=options.drawing?.observe(value=>{current=value;render();});
  const removeRecord=options.record.observe(value=>{
    if(snapshot&&snapshot.providerEpoch!==value.providerEpoch){
      cancelFeedback=undefined;if(cancellation)cancellation.phase='outcome-unknown';
    }
    snapshot=value;
    const owned=cancellation&&value.providerEpoch===cancellation.providerEpoch&&value.captures.find(c=>c.captureId===cancellation!.captureId);
    if(owned&&['cancelled','failed','saved'].includes(owned.phase)){
      cancellation=undefined;feedbackCaptureId=owned.captureId;cancelFeedback=owned.phase==='cancelled'?'cancelled':undefined;
    }
    const active=value.captures.filter(c=>['starting','recording','unknown'].includes(c.phase));
    if(active.some(c=>c.captureId!==feedbackCaptureId)&&!cancellation)cancelFeedback=undefined;
    activeId=active.length===1&&active[0].phase==='recording'?active[0].captureId:undefined;
    canStop=active.length===1;render();
  });
  return()=>{disposed=true;removeDrawing?.();removeRecord();};
}
