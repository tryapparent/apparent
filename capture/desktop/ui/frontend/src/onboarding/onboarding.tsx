import { useEffect, useRef, useState } from 'react';
import {useCallback} from "react";
import { Button } from '@apparent/ui/button';
import { recordKeys } from './shortcut/keys';
import frog from '../../../../assets/onboarding/frog.png';
import './onboarding.css';
import { savePen } from './pen/save';
import { PracticeCoach } from '../../../../../../onboarding/renderer/practice-coach';
import { MeetFrog } from '../../../../../../onboarding/renderer/frog/meet';
import { ShortcutTest } from '../../../../../../onboarding/renderer/shortcut/shortcut-test';
import { TourAction } from '../../../../../../onboarding/renderer/tour-actions';
import { ControlGuide } from './controls/control-guide';
import { AgentSetup } from './agent-setup';
import { subscribeOnboardingState } from './state';
import { OptionShortcutGesture, desktopShortcutSelection, shortcutCapture, shortcutInput, type ShortcutCapture } from '../../electron/onboarding/shortcut-editor.ts';
import {useWisprFlow,WisprPrompt,type WisprRequest} from './wispr/scene';
import { PermissionRepairFooter, Permissions, type PermissionRow as Row } from '../../../../../../onboarding/renderer/permissions';
import type { ConnectAction, ConnectSettings } from '../bridge';
type Action=string|{action:'frog-name';name:string}|{action:'frog-finish';takeoff:[number,number,number]}|({action:'shortcut';kind:'record';reserved:false}&ShortcutCapture);
type Editor={recording:boolean;externallyManaged:boolean;suggestedFn?:ShortcutCapture|null;error:string|null};
type State={frogNaming?:boolean;frogName?:string;frogError?:boolean;wisprFlowEnabled?:boolean;tutorial:'skipped'|'watched'|'practiced'|null;platform:'macos'|'linux';shortcutEditor:Editor|null;step:string;ready:boolean;fix:boolean;rows:Row[];index:number;count:number;shortcut:string;shortcutEditing:boolean;shortcutChosen:boolean;shortcutTested:boolean;practice:string|null;practiceAttempt?:string|null;firstCaptureRequired:boolean;penSaveId?:string;penPicker:boolean;penSelected:boolean;penError:boolean;penRgb:number[];testInstance:boolean;coachArrow?:number;coachPointsUp?:boolean};
declare global {interface Window {nativeOnboarding?:{readState:()=>Promise<State|null>;wispr?:WisprRequest;readConnect:()=>Promise<ConnectSettings>;connect:(action:ConnectAction)=>Promise<ConnectSettings>;closeConnect:()=>void;action:(action:Action)=>Promise<boolean>;onState:(listener:(state:State)=>void)=>()=>void;onDesktopShortcut?:(listener:(key:unknown)=>void)=>()=>void}}}
export function NativeOnboarding(){
  const [wideCoach,setWideCoach]=useState(window.innerWidth>=700);
  useEffect(()=>{const resize=()=>setWideCoach(window.innerWidth>=700);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);
  const coachFrog = useRef<HTMLCanvasElement>(null);
  const [heldKeys,setHeldKeys]=useState<string[]>([]);
  const changeButton=useRef<HTMLButtonElement>(null);
  const [state,setState]=useState<State|null>(null),[error,setError]=useState('');
  const wispr=useWisprFlow(Boolean(state?.wisprFlowEnabled&&state.platform==='macos'&&state.step==='shortcut'&&!state.fix&&!state.shortcutChosen),window.nativeOnboarding?.wispr);
  const currentShortcutState=useRef<State|null>(null),shortcutCancelled=useRef(false);
  const [penPhase,setPenPhase]=useState<'idle'|'preparing'|'hopping'>('idle');
  const penLanding=penPhase==='hopping',penBusy=penPhase!=='idle';
  const penFrog=useRef<HTMLImageElement|null>(null),penRun=useRef(0),penActive=useRef(false);
  const penSave=useRef<AbortController|null>(null);
  const penTimer=useRef<ReturnType<typeof setTimeout>|null>(null),penCommitted=useRef(false);
  useEffect(()=>()=>{penRun.current++;penSave.current?.abort();if(penTimer.current)clearTimeout(penTimer.current)},[]);
  useEffect(()=>{if(state?.step!=='welcome'||!state?.penPicker){penRun.current++;penSave.current?.abort();penActive.current=false;if(penTimer.current)clearTimeout(penTimer.current);penTimer.current=null;setPenPhase('idle');penCommitted.current=false}},[state?.step,state?.penPicker]);
  document.documentElement.classList.add('native-onboarding-shell');
  useEffect(()=>{const bridge=window.nativeOnboarding;return bridge?subscribeOnboardingState(bridge,next=>{
    const previous=currentShortcutState.current;
    if(next?.shortcutEditor?.recording&&(!previous?.shortcutEditor?.recording||next.platform!==previous.platform||next.step!==previous.step))shortcutCancelled.current=false;
    currentShortcutState.current=next;setState(next);
  }):undefined},[]);
  const sendAction=useCallback(async (value:Action)=>{
    if(typeof value==='string'&&['cancel-shortcut','back','close','later'].includes(value))shortcutCancelled.current=true;
    try{setError('');return await window.nativeOnboarding?.action(value)??false}catch{setError('The app connection was interrupted. Close setup and reopen it from apparent.');return false;}
  },[]);
  async function action(value:Action){await sendAction(value)}
  useEffect(()=>window.nativeOnboarding?.onDesktopShortcut?.(key=>{
    const selection=desktopShortcutSelection(shortcutCancelled.current?null:currentShortcutState.current,key);
    if(selection)void action(selection);
  }),[]);
  function finishPenHop(){
    if(penCommitted.current)return;
    penCommitted.current=true;
    if(penTimer.current)clearTimeout(penTimer.current);
    penTimer.current=null;
    const run=penRun.current;
    void (async()=>{
      try {if(!await window.nativeOnboarding?.action('continue'))throw Error();}
      catch {
        if(run!==penRun.current)return;
        penActive.current=false;penCommitted.current=false;setPenPhase('idle');
        setError('The app connection was interrupted. Close setup and reopen it from apparent.');
      }
    })();
  }
  async function confirmPen(colour:string){
    if(penBusy||penActive.current)return;
    penActive.current=true;const run=++penRun.current;
    penCommitted.current=false;setError('');setPenPhase('preparing');
    penSave.current=new AbortController();
    try {await savePen(window.nativeOnboarding,colour,penSave.current.signal)} catch(error) {
      if(run!==penRun.current)return;
      penActive.current=false;setPenPhase('idle');setError((error as Error).message);return;
    }
    if(run!==penRun.current)return;
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){finishPenHop();return;}
    const painted=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
    try {
      const image=penFrog.current;if(!image)throw Error('Missing frog');
      await Promise.all([image.decode(),document.fonts.ready]);
      await painted();if(run!==penRun.current)return;
      setPenPhase('hopping');await painted();if(run!==penRun.current)return;
      const hop=image.getAnimations().find(animation=>(animation as CSSAnimation).animationName==='native-pen-hop');
      if(!hop)throw Error('Hop did not start');
      await hop.finished;if(run!==penRun.current)return;
      // Let the landing remain visible. Advance from rendered animation completion, never a cold-start wall timer.
      await new Promise<void>(resolve=>{penTimer.current=setTimeout(resolve,180)});
      if(run===penRun.current)finishPenHop();
    } catch {
      if(run!==penRun.current)return;
      if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){finishPenHop();return;}
      penActive.current=false;setPenPhase('idle');setError('The frog could not finish its jump. Try again.');
    }
  }
  const optionGesture=useRef(new OptionShortcutGesture());
  const shortcutRecorder=useCallback((element:HTMLDivElement|null)=>{
    if(!element)return;
    element.focus();
    const wheel=()=>optionGesture.current.cancel();
    window.addEventListener('wheel',wheel,{capture:true,passive:true});
    return ()=>{
      window.removeEventListener('wheel',wheel,true);
      optionGesture.current.reset();
      setHeldKeys([]);
      queueMicrotask(()=>changeButton.current?.focus());
    };
  },[]);
  if(!state)return <main className="native-setup"><p>Connecting to apparent…</p></main>;
  if(state.step==='try-it'&&state.practice==='screen'&&state.platform==='macos')return null;
  const shortcutStep=state.step==='shortcut',listening=Boolean(state.shortcutEditor?.recording);
  const editing=Boolean(state.shortcutEditing||listening);
  const goAgain=state.step==='try-it'&&(!state.practice||state.practice==='start');
  const practice=state.step==='try-it'&&!goAgain,penPage=state.step==='welcome'&&state.penPicker;
  const practiceStage=state.practice==='note'?'screen-ink':state.practice;
  document.title=state.testInstance?'apparent onboarding preview 9':'apparent setup';
  function finishSetup() {
    const area = coachFrog.current?.getBoundingClientRect();
    if (!state?.frogName || !area) return action('practice-finish');
    return action({action:'frog-finish', takeoff:[area.x + area.width / 2, area.y + area.height / 2, area.width]});
  }
  if(practice){
    const practiceCommand = state.practice === 'whiteboard' ? 'practice-open-board'
      : state.practice === 'stop' ? 'practice-save-capture' : null;
    const practiceAction = practiceCommand && state.practiceAttempt
      ? () => void action(`${practiceCommand}:${state.practiceAttempt}`)
      : undefined;
    const control = ['whiteboard','stop','locate'].includes(state.practice??'')&&<ControlGuide kind={state.practice==='locate'?'locate':state.practice==='stop'?'finish':'whiteboard'} onTarget={practiceAction} />;
    return <PracticeCoach view={state} stage={practiceStage} wide={wideCoach} frog={frog} canvasRef={coachFrog}
      recordKeys={recordKeys(state.shortcut)} control={control} error={error} onAction={action} finishSetup={finishSetup} />;
  }
  return <main className="native-setup" data-agent-setup={state.step==='welcome'&&!state.penPicker} data-wispr={wispr.visible} data-shortcut-state={state.step==='shortcut'||goAgain}><header><span>{state.testInstance?'apparent · onboarding preview 9':shortcutStep?'apparent':'apparent · setup'}</span><Button variant="ghost" size="icon" aria-label="Close setup" onClick={()=>void action('close')}>×</Button></header><section ref={wispr.attach}>
    {wispr.visible?<WisprPrompt flow={wispr}/>:<>
    {state.step==='welcome'&&!state.penPicker&&<AgentSetup onContinue={()=>action('continue')} onLater={()=>action('later')}/>}
    {penPage&&<div className="native-pen-picker" aria-busy={penBusy}><h1>Pick your pen.</h1>{(error||state.penError)&&<p role="alert">{error||'The colour could not be saved. Try choosing it again.'}</p>}<div className="native-pencils">{([['coral',[217,76,68]],['purple',[122,88,199]],['blue',[59,121,189]],['green',[57,123,97]]] as const).map(([name,rgb])=><Button variant="ghost" key={name} aria-label={`${name} pen`} disabled={penBusy} aria-pressed={state.penSelected&&state.penRgb.every((component,index)=>component===rgb[index])} style={{'--pencil':`var(--apparent-pen-${name})`} as React.CSSProperties} onClick={()=>void confirmPen(name)}><span aria-hidden="true"/></Button>)}</div><div className="native-pond" data-landing={penLanding} style={{'--pond-colour':state.penSelected?`rgb(${state.penRgb.join(',')})`:'var(--apparent-muted)'} as React.CSSProperties}><svg className="native-puddle" viewBox="0 0 300 100" role="img" aria-label="Puddle in your selected pen colour"><path d="M22 49C9 21 65 11 99 17C133 1 169 18 192 12C229 4 249 28 275 31C310 37 295 69 263 73C244 94 208 86 180 90C144 102 122 84 91 90C48 93 6 78 22 49Z"/><ellipse className="native-puddle-ring" cx="150" cy="49" rx="48" ry="15"/></svg><img ref={penFrog} className="native-pond-frog" src={frog} alt="Frog beside the puddle"/></div></div>}
    {state.step==='permissions'&&<><Permissions platform={state.platform} rows={state.rows} repair={state.fix} action={action}/></>}
    {shortcutStep&&<ShortcutTest shortcut={state.shortcut} keys={recordKeys(state.shortcut)} editing={editing}
      tested={state.shortcutTested} heldKeys={heldKeys} error={error||state.shortcutEditor?.error||null}
      recorderRef={shortcutRecorder} recorderEvents={{
        onPointerDown:()=>optionGesture.current.pointer(true),
        onPointerUp:()=>optionGesture.current.pointer(false),
        onPointerCancel:()=>optionGesture.current.pointer(false),
        onBlur:()=>{optionGesture.current.reset();setHeldKeys([])},
        onKeyUp:event=>{
          const pressed=optionGesture.current.up(event);
          if(pressed&&!shortcutCancelled.current)void action({action:'shortcut',kind:'record',...pressed,reserved:false});
          setHeldKeys([event.ctrlKey?'Ctrl':'',event.altKey?(state.platform==='macos'?'Option':'Alt'):'',event.metaKey?(state.platform==='macos'?'⌘':'Super'):'',event.shiftKey?'Shift':''].filter(Boolean));
        },
        onKeyDown:event=>{
          if(event.key==='Tab')return;
          event.preventDefault();
          if(event.key==='Escape'){void action('cancel-shortcut');return;}
          if(!listening||shortcutCancelled.current||event.repeat)return;
          optionGesture.current.down(event,state.platform);
          const input=shortcutInput(event,state.platform);
          if(input==='pending'){setHeldKeys([event.ctrlKey?'Ctrl':'',event.altKey?(state.platform==='macos'?'Option':'Alt'):'',event.metaKey?(state.platform==='macos'?'⌘':'Super'):'',event.shiftKey?'Shift':''].filter(Boolean));setError('');return;}
          if(input==='fn-unavailable'){setError('Fn is unavailable here. Press a different shortcut.');return;}
          if(input==='native-copilot'){void action('resolve-copilot');return;}
          const pressed=shortcutCapture(event,state.platform);
          if(!pressed){setError('This key is unavailable. Press a different shortcut.');return;}
          void action({action:'shortcut',kind:'record',...pressed,reserved:false});
        },
      }}/>}
    {state.frogNaming&&<MeetFrog submit={name=>sendAction({action:'frog-name',name})} saveError={Boolean(state.frogError)}/>}
    {goAgain&&!state.frogNaming&&<><h1 className="native-shortcut-prompt">Try a practice capture.</h1><p>Use your recording shortcut to begin.</p></>}
    {state.step==='done'&&<><h1>Ready for your next idea.</h1><div className="native-explain"><img src={frog} alt=""/></div><p>apparent stays in the menu bar, ready when you are.</p></>}
    {error&&!penPage&&!shortcutStep&&<p role="alert">{error}</p>}
    </>}
    </section>{!wispr.visible&&state.fix&&<PermissionRepairFooter ready={state.ready} action={action}/>}{!wispr.visible&&!state.fix&&<footer><Button variant="ghost" onClick={()=>void action(shortcutStep&&editing?'cancel-shortcut':'back')} disabled={(state.index===0&&!penPage&&!(shortcutStep&&editing))||penBusy}>Back</Button>{!penPage&&!shortcutStep&&<progress className="native-setup-progress" aria-label="Setup progress" value={state.index+1} max={state.count}/>}{penPage&&<TourAction action="skip-pen" onAction={action} disabled={penBusy}/>}
      {!penPage&&!shortcutStep&&!state.frogNaming&&<TourAction action="later" onAction={action}/>}
      {shortcutStep&&!editing&&<div className="shortcut-test-actions">
        <Button ref={changeButton} variant="ghost" onClick={()=>void action('change-shortcut')}>Change shortcut</Button>
        <Button disabled={!state.shortcutTested} onClick={()=>void action('use-shortcut')}>Use shortcut</Button>
      </div>}
      {!goAgain&&!penPage&&!shortcutStep&&<Button onClick={()=>void action('continue')} disabled={state.step==='permissions'&&!state.ready}>{state.step==='welcome'?'Choose a pen':state.step==='done'?'Finish setup':state.step==='permissions'?'Choose recording shortcut':'Try a capture'}</Button>}</footer>}</main>;
}
