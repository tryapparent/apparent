export function screenCandidatePage(duration: number, offset: number, purpose: string, cursor: string) {
  const safe=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
  if(!safe(duration)||duration===0||!safe(offset)||!safe(duration+offset)||
    !['recovery','benchmark'].includes(purpose)||typeof cursor!=='string'||cursor.length>1024)throw Error('Invalid screen candidate request');
  const state:unknown=JSON.parse(cursor);
  let start=0, previous:number|undefined;
  if(state!==null) {
    if(typeof state!=='object'||Array.isArray(state)||Object.keys(state).sort().join(',')!=='previous,start')throw Error('Invalid screen cursor');
    const value=state as {start:unknown;previous:unknown};
    if(!safe(value.start)||value.start===0||value.start%480!==0||!safe(value.previous))throw Error('Invalid screen cursor');
    start=value.start;previous=value.previous;
  }
  const count=Math.ceil(duration/220);
  if(start>=count)throw Error('Exhausted screen cursor');
  const length=Math.min(480,count-start),end=start+length;
  return {times:Array.from({length},(_,index)=>(start+index)*220),previous,offset,
    maxEdge:purpose==='benchmark'?480:640,nextStart:end<count?end:null};
}

export function screenBundleTime(actual: number, offset: number): number {
  const time=actual+offset;
  if(!Number.isSafeInteger(actual)||actual<0||!Number.isSafeInteger(time)||time<0)throw Error('Invalid screen clock');
  return time;
}
