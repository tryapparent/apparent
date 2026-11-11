// Desktop presentation policy. Engine supplies fresh captured PCM amplitude;
// this never opens a device or infers permission, speech or recording health.
export type MeterState = {level:number; at:number};
export function stepMeter(previous:MeterState, input:number|null, receivedAt:number, now:number, reduced:boolean):MeterState {
  const target=now-receivedAt<300 && input!==null && Number.isFinite(input)?Math.max(0,Math.min(1,input)):0;
  const elapsed=Math.max(0,Math.min(1000,now-previous.at));
  const alpha=reduced?1:1-Math.exp(-elapsed/(target>previous.level?70:130));
  const level=previous.level+(target-previous.level)*alpha;
  return {level:level<.001?0:level,at:now};
}
