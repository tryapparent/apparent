import { useEffect, useRef, useState } from 'react';
import { Button } from '@apparent/ui/button';
import icon from '../../../../../../shared/assets/brand/apparent-app-icon.svg';
import frog from '../../../../assets/onboarding/frog.png';
import './onboarding.css';
import { savePen } from './pen/save';
import { GestureGuide } from './gesture-guide';
import { ControlGuide } from './control-guide';
import { practiceExit } from '../../electron/onboarding/presentation.ts';
import { OnboardingAccount } from './account';
import type { AccountState } from '../../electron/onboarding/account';
import { subscribeOnboardingState } from './state';
import { desktopShortcutSelection, fnSelectionActions, shortcutCapture, shortcutInput } from '../../electron/onboarding/shortcut-editor.ts';
import { Permissions, type PermissionRow as Row } from './permissions';
type Action=string|{action:'shortcut';kind:'record';keyCode:number;modifiers:number;key:string;reserved:false};
type Editor={recording:boolean;externallyManaged:boolean;error:string|null};
type State={account:AccountState|null;tutorial:'skipped'|'watched'|'practiced'|null;platform:'macos'|'linux';shortcutEditor:Editor|null;step:string;ready:boolean;fix:boolean;rows:Row[];index:number;count:number;shortcut:string;shortcutEditing:boolean;shortcutChosen:boolean;shortcutTested:boolean;practice:string|null;firstCaptureRequired:boolean;penSaveId?:string;penPicker:boolean;penSelected:boolean;penError:boolean;penRgb:number[];testInstance:boolean;coachArrow?:number;coachPointsUp?:boolean};
declare global {interface Window {nativeOnboarding?:{readState:()=>Promise<State|null>;action:(action:Action)=>Promise<boolean>;onState:(listener:(state:State)=>void)=>()=>void;onDesktopShortcut?:(listener:(key:unknown)=>void)=>()=>void}}}
export function NativeOnboarding(){
  const [wideCoach,setWideCoach]=useState(window.innerWidth>=700);
  useEffect(()=>{const resize=()=>setWideCoach(window.innerWidth>=700);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize)},[]);
  const [state,setState]=useState<State|null>(null),[error,setError]=useState('');
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
  async function sendAction(value:Action){
    if(typeof value==='string'&&['cancel-shortcut','back','close','later'].includes(value))shortcutCancelled.current=true;
    try{setError('');return await window.nativeOnboarding?.action(value)??false}catch{setError('The app connection was interrupted. Close setup and reopen it from apparent.');return false;}
  }
  async function action(value:Action){await sendAction(value)}
  useEffect(()=>window.nativeOnboarding?.onDesktopShortcut?.(key=>{
    const selection=desktopShortcutSelection(shortcutCancelled.current?null:currentShortcutState.current,key);
    if(selection)void action(selection);
  }),[]);
  const shortcutAdvance=useRef<string|null>(null);
  useEffect(()=>{
    const ready=state?.step==='shortcut'&&state.firstCaptureRequired&&state.shortcutChosen&&state.shortcutTested&&!state.shortcutEditing&&!state.shortcutEditor?.recording;
    if(!ready){shortcutAdvance.current=null;return;}
    if(shortcutAdvance.current===state.shortcut)return;
    shortcutAdvance.current=state.shortcut;
    void action('continue');
  },[state?.step,state?.firstCaptureRequired,state?.shortcutChosen,state?.shortcutTested,state?.shortcutEditing,state?.shortcutEditor?.recording,state?.shortcut]);
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
  const shortcutRecorder=useRef<HTMLDivElement|null>(null);
  const chooseFn=async()=>{for(const next of fnSelectionActions(state?.platform??'linux',Boolean(state?.shortcutEditor?.recording))){if(!await sendAction(next))break;}};
  useEffect(()=>{if(state?.shortcutEditor?.recording)shortcutRecorder.current?.focus()},[state?.shortcutEditor?.recording]);
  if(!state)return <main className="native-setup"><p>Connecting to apparent…</p></main>;
  const goAgain=state.step==='try-it'&&(!state.practice||state.practice==='start');
  const practice=state.step==='try-it'&&!goAgain,penPage=state.step==='welcome'&&state.penPicker;
  const practiceStage=state.practice==='note'?'screen-ink':state.practice;
  const boardName='Whiteboard';
  const trackpadHint=practiceStage==='screen-ink';
  const helper=<aside className="native-trackpad-helper" aria-label="Trackpad drawing hint"><div className="native-trackpad-helper-content"><strong>Pressing down on your trackpad?</strong><p>No need. Just hold Shift and glide.</p></div></aside>;
  document.title=state.testInstance?'apparent onboarding preview 9':'apparent setup';
  if(practice){
    const content:Record<string,{title:string;text:string;button?:string;action?:string}>={
      start:{title:'Go again.',text:''},
      screen:{title:'Choose Screen.',text:'Choose Screen in the capture controls. Whiteboard becomes available once recording starts.'},
      whiteboard:{title:`Open ${boardName}.`,text:'Open Whiteboard from the recording controls.'},
      'board-ink':{title:'Draw on the whiteboard.',text:'Draw a circle or arrow on the white paper. You don’t need Shift here. Release to continue.'},
      'screen-ink':{title:'Draw on your screen.',text:'Hold Shift and circle something in your window.'},
      stop:{title:'Finish your capture.',text:`Press ${state.shortcut} again. Your sketch and screen marks stay together.`},
      preparing:{title:'Preparing your capture…',text:'Recording has stopped. Your marks and context are being brought together.'},
      copied:{title:'Copied. Try pasting it.',text:'Your capture is copied. Paste it into your agent.',button:'Show paste steps',action:'practice-paste'},
      paste:{title:'Paste your capture.',text:`In your agent, press ${state.platform==='linux'?'Ctrl':'⌘'} V. Confirm when it appears.`,button:'Confirm paste',action:'practice-pasted'},
      locate:{title:'apparent lives here.',text:`Click the a in your ${state.platform==='linux'?'system tray':'menu bar'}, then Open Latest Capture.`},
      complete:{title:'Ready for your next idea.',text:'You can record, draw, add notes, paste, and find your captures. Your setup is complete.',button:'Finish setup',action:'practice-finish'},
      retry:{title:'Try another capture.',text:`Press ${state.shortcut} to start again, then follow the drawing prompts. Your previous capture is saved.`},
      'copy-failed':{title:'Saved, but not copied.',text:'Your capture is saved. Find it in apparent’s menu.',button:'Find saved capture',action:'practice-locate'},
    };
    const c=content[practiceStage??'start']??content.start,exit=practiceExit(practiceStage??'start');
    return <><main className="native-coach" data-paired={trackpadHint&&wideCoach} data-stage={practiceStage} data-arrow={state.coachPointsUp} style={{'--coach-arrow':`${(state.coachArrow??190)-24}px`} as React.CSSProperties}><img key={practiceStage} src={frog} alt="Frog guide"/><div className="native-coach-content"><div className="native-coach-label">Your first capture</div><h1>{c.title}</h1>{c.text&&<p>{c.text}</p>}{(['start','retry','screen-ink','copied','paste'].includes(practiceStage??'start'))&&<GestureGuide key={practiceStage} kind={practiceStage==='screen-ink'?'draw':practiceStage==='copied'||practiceStage==='paste'?'paste':'record'} shortcut={state.shortcut} platform={state.platform}/>}{['screen','whiteboard','stop','locate'].includes(practiceStage??'')&&<ControlGuide key={practiceStage} kind={practiceStage==='stop'?'finish':practiceStage==='locate'?'locate':'whiteboard'} screenOnly={practiceStage==='screen'} directWhiteboard={state.platform==='linux'&&practiceStage==='whiteboard'}/>} {c.button&&<Button onClick={()=>void action(c.action!)}>{c.button}</Button>}{trackpadHint&&!wideCoach&&helper}{error&&<p role="alert">{error}</p>}<div className="native-coach-actions"><Button variant="outline" className="native-later" onClick={()=>void action('later')}>{exit.label}</Button><small className="native-exit-detail">{exit.detail}</small></div></div></main>{trackpadHint&&wideCoach&&helper}</>;
  }
  return <main className="native-setup" data-shortcut-state={state.step==='shortcut'||goAgain}><header><span>{state.testInstance?'apparent · onboarding preview 9':'apparent · setup'}</span><Button variant="ghost" size="icon" aria-label="Close setup" onClick={()=>void action('close')}>×</Button></header><section>
    {state.step==='welcome'&&!state.penPicker&&<div className="native-welcome"><h1>Welcome.</h1><img src={icon} alt="apparent"/><OnboardingAccount state={state.account} action={action}/></div>}
    {penPage&&<div className="native-pen-picker" aria-busy={penBusy}><h1>Pick your pen.</h1>{(error||state.penError)&&<p role="alert">{error||'The colour could not be saved. Try choosing it again.'}</p>}<div className="native-pencils">{([['coral',[217,76,68]],['purple',[122,88,199]],['blue',[59,121,189]],['green',[57,123,97]]] as const).map(([name,rgb])=><Button variant="ghost" key={name} aria-label={`${name} pen`} disabled={penBusy} aria-pressed={state.penSelected&&state.penRgb.every((component,index)=>component===rgb[index])} style={{'--pencil':`var(--apparent-pen-${name})`} as React.CSSProperties} onClick={()=>void confirmPen(name)}><span aria-hidden="true"/></Button>)}</div><div className="native-pond" data-landing={penLanding} style={{'--pond-colour':state.penSelected?`rgb(${state.penRgb.join(',')})`:'var(--apparent-muted)'} as React.CSSProperties}><svg className="native-puddle" viewBox="0 0 300 100" role="img" aria-label="Puddle in your selected pen colour"><path d="M22 49C9 21 65 11 99 17C133 1 169 18 192 12C229 4 249 28 275 31C310 37 295 69 263 73C244 94 208 86 180 90C144 102 122 84 91 90C48 93 6 78 22 49Z"/><ellipse className="native-puddle-ring" cx="150" cy="49" rx="48" ry="15"/></svg><img ref={penFrog} className="native-pond-frog" src={frog} alt="Frog beside the puddle"/></div></div>}
    {state.step==='permissions'&&<><h1>{state.fix?'Allow access.':'We need three things.'}</h1><Permissions platform={state.platform} rows={state.rows} action={action}/></>}
    {state.step==='shortcut'&&<><h1>{!state.shortcutChosen?'Choose your shortcut.':state.shortcutTested?'Go again.':'Try your shortcut.'}</h1><div className="native-shortcut" data-managed={state.shortcutEditor?.externallyManaged}>
      {state.shortcutEditor?.recording?<div ref={shortcutRecorder} tabIndex={0} role="group" aria-label="Shortcut recorder" onKeyDown={event=>{
      if(event.key==='Tab'||event.target!==event.currentTarget)return;
      event.preventDefault();if(event.key==='Escape'){void action('cancel-shortcut');return;}
      if(event.repeat)return;
      const input=shortcutInput(event,state.platform);
      if(input==='pending'){setError('');return;}
      if(input==='fn-unavailable'){setError('Fn is not available in this Linux shortcut recorder. Choose Copilot or another key.');return;}
      if(input==='native-copilot'){void action('resolve-copilot');return;}
      const pressed=shortcutCapture(event,state.platform);
      if(!pressed){setError(state.platform==='linux'?'Apparent cannot use that key. Try Copilot, a letter or a number.':'Apparent cannot use that key. Choose Fn alone, a letter or a number.');return;}
      setError('');
      void action({action:'shortcut',kind:'record',...pressed,reserved:false});
      }}><p>Hold any modifiers, then press a key.</p>{state.platform==='linux'&&<p className="native-shortcut-detail">Copilot works alone or with modifiers. Fn works when your keyboard sends it to the app.</p>}<div className="native-shortcut-choices">{state.platform==='macos'&&<Button onClick={chooseFn}>Use Fn</Button>}<Button variant="outline" onClick={()=>void action('cancel-shortcut')}>Cancel</Button></div></div>:<>
        {state.shortcutChosen?<kbd>{state.shortcut}</kbd>:state.shortcutEditor?.externallyManaged?<><p>Your desktop already has a recording shortcut:</p><kbd>{state.shortcut}</kbd></>:<p>No shortcut selected.</p>}
        <div className="native-shortcut-choices">{state.platform==='macos'&&!state.shortcutChosen&&<Button onClick={chooseFn}>Use Fn</Button>}{state.shortcutEditor?.externallyManaged&&<Button onClick={()=>void action('use-desktop-shortcut')}>Use {state.shortcut}</Button>}
        <Button variant="outline" onClick={()=>void action('change-shortcut')}>{state.shortcutEditor?.externallyManaged?'Choose another shortcut':state.shortcutChosen?'Change shortcut':'Choose shortcut'}</Button></div>{state.shortcutEditor?.externallyManaged&&<p className="native-shortcut-detail">Choosing another shortcut keeps the desktop binding available too.</p>}
      </>}{state.shortcutEditor?.error&&<p role="alert">{state.shortcutEditor.error}</p>}</div></>}
    {goAgain&&<><h1>Go again.</h1><div className="native-shortcut"><kbd>{state.shortcut}</kbd></div></>}
    {state.step==='done'&&<><h1>Ready for your next idea.</h1><div className="native-explain"><img src={frog} alt=""/></div><p>apparent stays in the menu bar, ready when you are.</p></>}
    {error&&!penPage&&<p role="alert">{error}</p>}
    </section><footer><Button variant="ghost" onClick={()=>void action('back')} disabled={state.index===0||penBusy}>Back</Button>{!penPage&&<span>{state.index+1} / {state.count}</span>}{!goAgain&&!penPage&&<Button onClick={()=>void action('continue')} disabled={(state.step==='permissions'&&!state.ready)||(state.step==='shortcut'&&state.firstCaptureRequired&&(!state.shortcutChosen||!state.shortcutTested||state.shortcutEditor?.recording))}>{state.step==='welcome'?'Choose a pen':state.step==='done'?'Finish setup':state.step==='permissions'?(state.fix?'Finish permission setup':'Choose recording shortcut'):state.step==='shortcut'?'Continue':'Try a capture'}</Button>}</footer></main>;
}
