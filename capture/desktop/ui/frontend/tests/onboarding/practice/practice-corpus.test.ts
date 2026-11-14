// Private compatibility experiment, NOT a production adapter or protocol validator.
// Native admission facts come from the old Session trace. Lesson outputs are used
// ONLY as assertions, never to update the TypeScript policy state.
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PracticeHost, type Batch} from '../../../electron/onboarding/practice-host.ts';
import assert from 'node:assert/strict';
import {type Event, type Stage} from '../../../electron/onboarding/practice.ts';

type Query={stage:Stage;latest:boolean;desktopStage:boolean;locating:boolean;
  practiceActive:boolean;practiceRecording:boolean;bundle:string|null;receipt:unknown};
type Fact={method:string;input?:string;completed?:boolean;frame?:unknown;board?:boolean;
  screen?:number;processing?:boolean;saved?:boolean|null;clipboard?:boolean|null;
  captureId?:string;bundle?:string|null;path?:string;action?:string};
type Step={fact:Fact;before:Query;after:Query;messages:{type:string;practice?:Stage}[]};
type Trace={name:string;initial:{queries:Query;messages:{type:string;practice?:Stage}[]};steps:Step[]};
const corpus=JSON.parse(readFileSync(new URL('./fixtures/corpus.json',import.meta.url),'utf8')) as {cases:Trace[]};
function replay(mode:'normal'|'omit-reset'|'wrong-save-order'){
  const mismatches:{trace:string;call:number;field:string;actual:unknown;expected:unknown}[]=[];
  let calls=0,projections=0,batches=0;
  for(const trace of corpus.cases){
    const host=new PracticeHost();let sequence=0,attempt=0;
    let state=host.state;
    const batch=(events:Batch['events'])=>{const reply=host.accept({type:'practice-batch',version:1,source:'1',transport:'2',
      attempt:String(attempt),capture:String(attempt),sequence:String(++sequence),board:'synthetic-board',
      intent:events.some(e=>e.type==='action')?String(sequence):null,events});state=host.state;return reply;};
    assert.equal(state.stage,trace.initial.queries.stage);
    assert.equal(state.latest,trace.initial.queries.latest);
    for(const message of trace.initial.messages)if(message.type==='state'){
      projections++;assert.equal(state.stage,message.practice);
    }
    const send=(event:Event)=>{if(event.type==='action'&&!['practice-paste','practice-pasted','practice-locate','practice-finish'].includes(event.action))return;batch([event]);};
    const observe=(board:boolean,screen:number,processing:boolean,saved:boolean|null)=>{
      const events:Event[]=[{type:'ink',board,screen}];
      if(mode==='wrong-save-order'&&saved!==null)events.push({type:'saved',copied:saved});
      if(processing)events.push({type:'processing'});
      if(mode!=='wrong-save-order'&&saved!==null)events.push({type:'saved',copied:saved});
      const reply=batch(events);
      if(processing)assert.equal(reply.closeBoard,false,'no transient ScreenInk board close');
    };
    trace.steps.forEach((step,index)=>{
      // Whitelist native gate/receipt facts. Do not feed old lesson stage,
      // latest, locating, desktopStage, or renderer projection into reduction.
      const f=step.fact,active=step.before.practiceActive;
      const recording=step.before.practiceRecording,receipt=step.before.receipt;
      const bundle=step.before.bundle;
      switch(f.method){
        case 'input':
          if(active&&f.input==='CaptureSelecting')send({type:'selecting'});
          if(active&&f.input==='CaptureStarted'&&mode!=='omit-reset'){attempt++;batch([{type:'reset'}]);}
          // Flow's native eligibility is not lesson state; the future producer
          // must send this admitted fact only after its reset barrier.
          if(f.input==='CaptureStarted'&&step.after.practiceRecording)send({type:'started'});
          if(active&&f.input==='CaptureEnded'&&f.completed===false)send({type:'cancelled'});
          break;
        case 'practice_board':send({type:'whiteboard-visible',visible:f.frame!==null});break;
        case 'practice_whiteboard':send({type:'whiteboard'});break;
        case 'observe_practice':
          if(active){assert.equal(typeof f.board,'boolean');assert.equal(typeof f.screen,'number');
            observe(f.board!,f.screen!,f.processing===true,f.saved??null);batches++;}
          break;
        case 'practice_note_saved':if(active)send({type:'note',saved:f.saved===true});break;
        case 'practice_completion':
          if(active&&recording&&f.captureId&&receipt===null){
            if(f.bundle!==null)observe(false,0,true,f.clipboard===true);
            else send({type:'cancelled'});
          }
          break;
        case 'practice_opened_bundle':if(bundle===f.path)send({type:'opened-latest'});break;
        case 'action':if(active)send({type:'action',action:f.action!});break;
        case 'sync':break;
        default:throw Error('Unreviewed fact method: '+f.method);
      }
      calls++;
      const check=(field:string,actual:unknown,expected:unknown)=>{
        if(actual!==expected)mismatches.push({trace:trace.name,call:index,field,actual,expected});
      };
      check('stage',state.stage,step.after.stage);check('latest',state.latest,step.after.latest);
      check('desktopStage',['note','screen-ink'].includes(state.stage),step.after.desktopStage);
      check('locating',state.stage==='locate',step.after.locating);
      for(const message of step.messages)if(message.type==='state'){
        projections++;check('projection.practice',state.stage,message.practice);
      }
    });
  }
  return {mode,traces:corpus.cases.length,calls,projections,batches,mismatches};
}
test('real old Session producer corpus through production trusted host: 212 calls, 134 projections',()=>{
  const normal=replay('normal');assert.deepEqual(normal.mismatches,[]);
  assert.equal(normal.calls,212);assert.equal(normal.projections,134);
  assert.ok(replay('omit-reset').mismatches.length>0);assert.ok(replay('wrong-save-order').mismatches.length>0);
});
