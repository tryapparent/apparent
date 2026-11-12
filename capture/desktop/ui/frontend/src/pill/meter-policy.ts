// Desktop presentation of Engine's 24 captured PCM windows (40 ms spacing,
// overlapping 80 ms RMS). Newest is rightmost. Never invent samples on a timer.
export const WAVEFORM_BINS=24;
export function waveformLevels(input:readonly number[]|null, receivedAt:number, now:number):number[] {
  if(!input || input.length!==WAVEFORM_BINS || now-receivedAt>=300)return Array(WAVEFORM_BINS).fill(0);
  return input.map(level=>Number.isFinite(level)?Math.min(1,Math.pow(Math.max(0,Math.min(1,level)),.55)*1.15):0);
}
export function waveformHeight(level:number,reduced:boolean):number {
  return reduced?2:2+26*level;
}
