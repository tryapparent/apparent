import {useRef,type ReactNode} from 'react';
import {Button} from '@apparent/ui/button';
import {StickyNote} from '@apparent/ui/icons';
import type {PillView} from './bridge';
import {InputMeter} from './input-meter';
import {Check,Circle,CircleAlert,ClipboardPaste,Link,LoaderCircle,Monitor,PenLine,Scan,ScanEye,Smartphone,Square,X,type LucideIcon} from 'lucide-react';
import './surface.css';
const actionIcons:Record<string,LucideIcon>={
 'select-area':Scan,'switch-area':Scan,'select-screen':Monitor,'switch-screen':Monitor,
 'select-iphone':Smartphone,'switch-iphone':Smartphone,record:Circle,whiteboard:PenLine,
 finish:Square,paste:ClipboardPaste,'copy-link':Link,inspect:ScanEye,cancel:X,dismiss:X,
};

type Props={view:PillView;pending?:boolean;controlsDisabled?:boolean;children?:ReactNode;error?:boolean;receivedAt?:number;reduced?:boolean;manualDrag?:boolean;onAction:(action:string,drop?:boolean)=>void;onBeginDrag?:()=>Promise<void>;onBeginPaste?:()=>Promise<void>;onCancelPaste?:()=>void};
/** The production recording controls, also used inertly by onboarding examples. */
export function PillSurface({view,pending=false,controlsDisabled=false,children,error=false,receivedAt=0,reduced=false,manualDrag=false,onAction,onBeginDrag,onBeginPaste,onCancelPaste}:Props){
 const pasteStart=useRef<[number,number]|null>(null);
  const uploading=view.phase==='completed' && view.actions.some(action=>action.label==='Cancel upload');
  const uploadStopped=view.phase==='completed' && (view.label.startsWith('Upload failed') || view.label.startsWith('Upload cancelled'));
  // Keep the named X at the trailing edge in both visual and keyboard order,
  // independent of the backend's action admission order.
  const isClose=(id:string)=>id==='cancel'||id==='dismiss';
  const controls=view.actions.filter(action=>action.id!=='notes')
    .sort((a,b)=>Number(isClose(a.id))-Number(isClose(b.id)));
  // Mirror Whiteboard → Finish: Inspect precedes the primary Paste action.
  const pasteIndex=controls.findIndex(action=>action.id==='paste');
  const inspectIndex=controls.findIndex(action=>action.id==='inspect');
  if(pasteIndex>=0 && inspectIndex>pasteIndex)
    [controls[pasteIndex],controls[inspectIndex]]=[controls[inspectIndex],controls[pasteIndex]];
  return <main data-revision={view.revision} className="pill apparent-theme" aria-label={view.phase==='selecting'?view.label:undefined} data-phase={view.phase} data-reduced={view.reducedMotion} data-warning={view.warning!==null}>
    <div className="pill-surface">
    <div className="pill-row">
    {(view.phase!=='selecting') && <div className={`lead ${view.draggable?'movable':''} ${manualDrag?'manual-drag':''}`} title={view.draggable?'Drag recording controls':undefined}
      onPointerDown={event=>{if(view.draggable && !(event.target as HTMLElement).closest('button') && manualDrag && event.button===0 && event.isPrimary)void onBeginDrag?.().catch(()=>{});}}>
      <span className={`indicator-slot ${view.phase}`}>
        {(uploading?<LoaderCircle aria-hidden="true" className="indicator processing"/>:uploadStopped?<CircleAlert aria-hidden="true" className="indicator stopped"/>:view.phase==='completed'?<Check aria-hidden="true" className="indicator completed"/>:view.phase==='processing'?<LoaderCircle aria-hidden="true" className="indicator processing"/>:<span aria-hidden="true" className={`indicator ${view.phase}`}/>)}
      </span>
      <span className="clock" role={view.phase==='completed'?'status':undefined} aria-label={view.phase==='recording'?`Recording ${view.clock}`:undefined}>
        {view.phase==='recording'?view.clock:view.phase==='processing'?'Processing…':view.label}
      </span>
    </div>}
    {view.inputWaveform!==null && view.phase==='recording' && <InputMeter input={view.inputWaveform} receivedAt={receivedAt} reduced={view.reducedMotion || reduced}/>}
    {view.warning && view.warning!==view.label && <span className="warning" role="status">{view.warning}</span>}
    {view.notice && <span className="notice" role="status">{view.notice}</span>}
    {error && <span role="alert">Action not confirmed. Use the recording shortcut or tray menu.</span>}
    {view.actions.length>0 && <div className="controls" role="group" aria-label="Recording controls" aria-busy={pending}>
      {controls.map(action=>{const Icon=action.label==='Cancel upload'?X:actionIcons[action.id];const iconOnly=isClose(action.id);return <Button key={action.id} variant={action.primary?'default':action.selected?'secondary':'ghost'}
        size={iconOnly?'icon':'default'} data-icon-only={iconOnly} aria-label={action.label} title={iconOnly?action.label:undefined}
        data-primary={action.primary} data-action={action.id}
        aria-pressed={action.id.startsWith('select-')?action.selected:undefined}
        disabled={!action.enabled || pending || controlsDisabled}
        onPointerDown={event=>{if(action.id==='paste' && event.button===0 && event.isPrimary){pasteStart.current=[event.screenX,event.screenY];event.currentTarget.setPointerCapture(event.pointerId);void onBeginPaste?.().catch(()=>{pasteStart.current=null;});}}}
        onPointerUp={event=>{if(action.id==='paste' && event.button===0 && event.isPrimary && pasteStart.current){const [x,y]=pasteStart.current;pasteStart.current=null;void onAction('paste',Math.hypot(event.screenX-x,event.screenY-y)>=24);}}}
        onPointerCancel={()=>{pasteStart.current=null;void onCancelPaste?.();}}
        onClick={event=>{if(action.id!=='paste' || event.detail===0)void onAction(action.id);}}>{Icon && <Icon aria-hidden="true"/>}{!iconOnly && <span>{action.label}</span>}</Button>;})}
    </div>}
    </div>
    {view.phase==='recording' && view.noteCount>0 && <div className="pill-notes-layer"><Button className="pill-notes" variant="ghost"
      aria-label={`${view.noteCount} saved ${view.noteCount===1?'note':'notes'}. Open notes`} disabled={pending || !view.actions.some(a=>a.id==='notes' && a.enabled)}
      onClick={()=>void onAction('notes')}><StickyNote aria-hidden="true"/><span>{view.noteCount>99?'99+':view.noteCount}</span></Button></div>}
    </div>
    {children}
  </main>;
}