/** Private parent pipe policy. Never import this module in preload or renderer. */
import {initialPractice, reducePractice, type Event, type Practice} from './practice.ts';
export const intents = ['practice-paste','practice-pasted','practice-locate','practice-finish'] as const;
export type Batch = {type:'practice-batch';version:1;source:string;transport:string;
  attempt:string;capture:string;sequence:string;intent:string|null;board:string|null;events:(Event|{type:'reset'})[]};
const identity=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
const keys=(v:Record<string,unknown>,names:string[])=>Object.keys(v).sort().join(',')===names.sort().join(',');
function event(v:unknown):v is Batch['events'][number]{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const e=v as Record<string,unknown>;
  switch(e.type){
    case 'reset':case 'selecting':case 'started':case 'whiteboard':case 'processing':case 'cancelled':case 'opened-latest':return keys(e,['type']);
    case 'ink':return keys(e,['type','board','screen'])&&typeof e.board==='boolean'&&Number.isSafeInteger(e.screen)&&(e.screen as number)>=0;
    case 'whiteboard-visible':return keys(e,['type','visible'])&&typeof e.visible==='boolean';
    case 'note':return keys(e,['type','saved'])&&typeof e.saved==='boolean';
    case 'saved':return keys(e,['type','copied'])&&typeof e.copied==='boolean';
    case 'action':return keys(e,['type','action'])&&intents.includes(e.action as typeof intents[number]);
    default:return false;
  }
}
export class PracticeHost {
  state:Practice=initialPractice();
  private previous:Batch|null=null;
  accept(value:unknown){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid practice batch');
    const b=value as Batch;
    if(!keys(value as Record<string,unknown>,['type','version','source','transport','attempt','capture','sequence','intent','board','events'])||
      b.type!=='practice-batch'||b.version!==1||![b.source,b.transport,b.attempt,b.capture,b.sequence].every(identity)||
      !(b.intent===null||identity(b.intent))||!(b.board===null||typeof b.board==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(b.board))||
      !Array.isArray(b.events)||!b.events.length||b.events.length>8||JSON.stringify(b).length>4096||!b.events.every(event))throw Error('Malformed practice batch');
    const old=this.previous;
    if(BigInt(b.sequence)!==(old?BigInt(old.sequence)+1n:1n)||old&&(b.source!==old.source||b.transport!==old.transport))throw Error('Retired or reordered practice batch');
    const reset=b.events[0].type==='reset';
    if(old&&(b.attempt!==old.attempt||b.capture!==old.capture)&&(!reset||BigInt(b.attempt)!==BigInt(old.attempt)+1n))throw Error('Missing reset barrier');
    if(b.events.slice(1).some(e=>e.type==='reset')||b.events.filter(e=>e.type==='action').length!==(b.intent===null?0:1))throw Error('Invalid intent barrier');
    const before=this.state.stage;
    let accepted=false;
    for(const e of b.events){if(e.type==='reset')this.state=initialPractice();else{const result=reducePractice(this.state,e);this.state=result.state;accepted ||= result.accepted;}}
    this.previous=b;
    const desktopStage=['note','screen-ink'].includes(this.state.stage);
    return {type:'practice-disposition',version:1,source:b.source,transport:b.transport,attempt:b.attempt,capture:b.capture,
      sequence:b.sequence,intent:b.intent,board:b.board,stage:this.state.stage,latest:this.state.latest,
      locating:this.state.stage==='locate',desktopStage,closeBoard:!['note','screen-ink'].includes(before)&&desktopStage,
      accepted};
  }
}
