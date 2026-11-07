import { cloneJsonDto, isRequestId } from '../../wire.ts';
export type DrawingIntent='open'|'undo'|'clear'|'close';
export interface DrawingSnapshot {
  revision:number;
  phase:'idle'|'preparing'|'ready'|'draining'|'complete'|'unavailable';
  captureRequestId?:string;
  board?:{open:boolean;strokeCount:number;activeGesture:boolean};
  controlOutcome?:'unknown';
}
export interface DrawingAction { intent:DrawingIntent;captureRequestId:string;revision:number }
export interface DrawingHostPort {
  read():Promise<DrawingSnapshot>;
  observe(listener:(snapshot:DrawingSnapshot)=>void):()=>void;
  act(action:DrawingAction):Promise<'requested'|'refused'|'outcome-unknown'>;
}
export interface DrawingRendererPort {read():Promise<DrawingSnapshot>;act(action:DrawingAction):Promise<'requested'|'refused'|'outcome-unknown'>}
export const DRAWING_CHANNELS=Object.freeze({read:'apparent:record:drawing:read',act:'apparent:record:drawing:act'});
const uint=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
const exact=(value:Record<string,unknown>,keys:string[],optional:string[]=[])=>keys.every(k=>Object.hasOwn(value,k))&&Object.keys(value).every(k=>keys.includes(k)||optional.includes(k));
export function drawingSnapshot(value:unknown):DrawingSnapshot|undefined{
  const v=cloneJsonDto(value) as Record<string,unknown>|undefined;
  if(!v||Array.isArray(v)||!exact(v,['revision','phase'],['captureRequestId','board','controlOutcome'])||!uint(v.revision)
    ||!['idle','preparing','ready','draining','complete','unavailable'].includes(String(v.phase)))return;
  if(v.captureRequestId!==undefined&&!isRequestId(v.captureRequestId))return;
  if(v.controlOutcome!==undefined&&v.controlOutcome!=='unknown')return;
  if(v.board!==undefined){const b=v.board as Record<string,unknown>;if(!b||Array.isArray(b)||!exact(b,['open','strokeCount','activeGesture'])
    ||typeof b.open!=='boolean'||typeof b.activeGesture!=='boolean'||!uint(b.strokeCount)||Number(b.strokeCount)>4096)return;}
  if(v.phase!=='idle'&&!isRequestId(v.captureRequestId))return;
  return v as unknown as DrawingSnapshot;
}
export function drawingAction(value:unknown):DrawingAction|undefined{
  const v=cloneJsonDto(value) as Record<string,unknown>|undefined;
  if(!v||Array.isArray(v)||!exact(v,['intent','captureRequestId','revision'])||!['open','undo','clear','close'].includes(String(v.intent))
    ||!isRequestId(v.captureRequestId)||!uint(v.revision))return;
  return v as unknown as DrawingAction;
}
