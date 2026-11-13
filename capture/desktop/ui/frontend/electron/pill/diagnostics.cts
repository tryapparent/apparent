// Host-only formatting; accepts unknown inputs and retains only bounded facts.
'use strict';

const REASONS=new Set([
  'invalid_parent_frame','renderer_gone','parent_state_timeout','render_readiness_timeout',
  'layout_measurement_exception','invalid_native_window_identity','uncaught_exception',
  'parent_stream_end','parent_stream_error','window_closed'
]);
const PHASES=new Set(['hidden','selecting','recording','processing','completed']);
const RENDERER_REASONS=new Set(['clean-exit','abnormal-exit','killed','crashed','oom','launch-failed','integrity-failure','memory-eviction']);
const FRAME_CODES=new Set(['malformed','oversize','truncated']);
const int=(value:unknown,min:number,max:number):number|null=>
  typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max?value:null;
const fields=(value:unknown):Record<string,unknown>=>
  value!==null&&typeof value==='object'?value as Record<string,unknown>:{};

function formatPillDiagnostic(reason:unknown,input:unknown={},extra:unknown={}):string{
  const snapshot=fields(input),detail=fields(extra);
  const safeReason=typeof reason==='string'&&REASONS.has(reason)?reason:'unknown';
  const stateAgeMs=int(snapshot.stateAgeMs,0,86400000),phase=snapshot.phase;
  const row:Record<string,string|number|boolean|null>={kind:'apparent-pill-diagnostic',reason:safeReason,pid:int(snapshot.pid,1,0x7fffffff),
    phase:typeof phase==='string'&&PHASES.has(phase)?phase:null,revision:int(snapshot.revision,0,Number.MAX_SAFE_INTEGER),
    rendererReady:snapshot.rendererReady===true,activated:snapshot.activated===true,loaded:snapshot.loaded===true,
    elapsedSinceStateMs:stateAgeMs,
    parentStateDeadlineRemainingMs:stateAgeMs===null?null:Math.max(0,5000-stateAgeMs),
    renderReadinessDeadlineRemainingMs:int(snapshot.renderReadinessDeadlineRemainingMs,0,5000)};
  if(safeReason==='invalid_parent_frame'){
    const code=detail.frameCode;row.frameCode=typeof code==='string'&&FRAME_CODES.has(code)?code:'malformed';
  }
  if(safeReason==='renderer_gone'){
    const rendererReason=detail.rendererReason;
    row.rendererReason=typeof rendererReason==='string'&&RENDERER_REASONS.has(rendererReason)?rendererReason:'unknown';
    const exitCode=int(detail.exitCode,-0x80000000,0x7fffffff);
    if(exitCode!==null)row.rendererExitCode=exitCode;
  }
  return JSON.stringify(row);
}

function writePillDiagnostic(reason:unknown,snapshot:unknown,detail?:unknown):void{
  try{
    const line=formatPillDiagnostic(reason,snapshot,detail)+'\n';
    if(Buffer.byteLength(line,'utf8')<=768)require('node:fs').writeSync(2,line);
  }catch{/* Diagnostics must not alter the host's existing failure behavior. */}
}

module.exports={formatPillDiagnostic,writePillDiagnostic};
