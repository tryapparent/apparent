import type {DestinationView} from './destinations';
export type PillView = {
  transcript?: import('../../../../../../record/transcription/src/policy').Preview | null;
  revision:number; phase:'hidden'|'selecting'|'recording'|'processing'|'completed';
  clock:string; label:string; warning:string|null;notice:string|null; reducedMotion:boolean; draggable:boolean;inputWaveform:number[]|null;
  noteCount:number;
  actions:{id:string;label:string;enabled:boolean;selected:boolean;primary:boolean}[];
};
declare global { interface Window { apparentPill?: {
  read:()=>Promise<PillView|null>;
  destinations:()=>Promise<DestinationView|null>;
  destinationAction:(capture:string,action:'choose'|'retry'|'cancel'|'dismiss'|'copy'|'setup',id?:string)=>Promise<DestinationView|null>;
  destinationFocus:(focused:boolean)=>Promise<void>;
  subscribeDestinations:(callback:(state:DestinationView|null)=>void)=>()=>void;
  layout:(revision:number)=>Promise<void>;
  manualDrag:boolean;
  beginDrag:(revision:number)=>Promise<void>;
  beginPaste:(revision:number)=>Promise<void>;
  cancelPaste:()=>Promise<void>;
  act:(revision:number,action:string,drop?:boolean)=>Promise<void|{cancelled?:true;confirmationRequired?:true}>;
  subscribe:(callback:(state:PillView)=>void)=>()=>void;
}; } }
