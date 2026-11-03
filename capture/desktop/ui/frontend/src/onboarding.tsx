import { useEffect, useState } from 'react';
import { Button } from '@apparent/ui/button';
import icon from '../../../assets/app-icon.png';
import frog from '../../../../../public/site/public/assets/pond/frog-rest-cohesive.png';
import './onboarding.css';
type Row={permission:string;status:string;required:boolean;reopening:boolean;relaunch:boolean};
type State={step:string;ready:boolean;fix:boolean;rows:Row[];index:number;count:number;shortcut:string;shortcutEditing:boolean;shortcutChosen:boolean;practice:string|null;firstCaptureRequired:boolean;penPicker:boolean;penSelected:boolean;penError:boolean;penRgb:number[];testInstance:boolean;coachArrow?:number;coachPointsUp?:boolean};
declare global {interface Window {nativeOnboarding?:{readState:()=>Promise<State|null>;action:(action:string)=>Promise<boolean>;onState:(listener:(state:State)=>void)=>()=>void}}}
const permissionNames:Record<string,string>={'screen-recording':'Screen & System Audio Recording',microphone:'Microphone',accessibility:'Accessibility','speech-recognition':'Speech Recognition',camera:'Camera'};
export function NativeOnboarding(){
  const [state,setState]=useState<State|null>(null),[error,setError]=useState('');
  document.documentElement.classList.add('native-onboarding-shell');
  useEffect(()=>{const bridge=window.nativeOnboarding;const off=bridge?.onState(setState);void bridge?.readState().then(setState);return()=>off?.()},[]);
  async function action(value:string){try{setError('');await window.nativeOnboarding?.action(value)}catch{setError('The app connection was interrupted. Close setup and reopen it from Apparent.')}}
  if(!state)return <main className="native-setup"><p>Connecting to Apparent…</p></main>;
  const practice=state.step==='try-it';
  const boardName=state.testInstance?'Test board':'Whiteboard';
  document.title=state.testInstance?'Apparent Onboarding Test':'Apparent setup';
  if(practice){
    const content:Record<string,{title:string;text:string;button?:string;action?:string}>={
      start:{title:'Start your first capture.',text:`Press ${state.shortcut} to start recording.`},
      whiteboard:{title:`Open ${boardName}.`,text:`Click ${boardName} in this app’s recording controls at the top of your screen.`},
      'board-ink':{title:state.testInstance?'Draw on the Test Whiteboard.':'Draw on the whiteboard.',text:'Try a circle or an arrow. The guide moves on when you finish your mark.'},
      'screen-ink':{title:'Draw on your screen.',text:'Hold Shift and circle something in your window.'},
      stop:{title:'Finish your capture.',text:`Press ${state.shortcut} again. Your sketch and screen marks stay together.`},
      preparing:{title:'Preparing your capture…',text:'Recording has stopped. Your marks and context are being brought together.'},
      copied:{title:'Copied. Try pasting it.',text:'Your capture is on the clipboard. Open the agent you use and paste it there.',button:'Show paste instructions',action:'practice-paste'},
      paste:{title:'Paste your capture.',text:'Press ⌘ V in your agent. After checking that the capture appeared, confirm below.',button:'I’ve pasted it',action:'practice-pasted'},
      locate:{title:'Apparent lives here.',text:'Find the Apparent icon in your menu bar. Click it, then choose Open Latest Capture.'},
      complete:{title:'Ready for your next idea.',text:'You can record, draw, paste, and find your captures. Nice first hop.',button:'Finish setup',action:'practice-finish'},
      retry:{title:'Try another capture.',text:`Press ${state.shortcut}, open Whiteboard, then try both drawing steps. Your previous capture was kept.`},
      'copy-failed':{title:'Saved, but not copied.',text:'The capture is saved. Open it from Apparent’s menu; setup has not marked the paste lesson complete.'},
    };
    const c=content[state.practice??'start']??content.start;
    return <main className="native-coach" data-stage={state.practice} data-arrow={state.coachPointsUp} style={{'--coach-arrow':`${(state.coachArrow??190)-20}px`} as React.CSSProperties}><img key={state.practice} src={frog} alt="Frog guide"/><div className="native-coach-label">{state.testInstance?'Apparent Test · first capture':'Your first capture'}</div><h1>{c.title}</h1><p>{c.text}</p>{c.button&&<Button onClick={()=>void action(c.action!)}>{c.button}</Button>}{error&&<p role="alert">{error}</p>}<button className="native-later" onClick={()=>void action('later')}>Try later</button></main>;
  }
  return <main className="native-setup"><header><span>apparent · onboarding test</span><button aria-label="Close setup" onClick={()=>void action('close')}>×</button></header><section>
    {state.step==='welcome'&&!state.penPicker&&<div className="native-welcome"><h1>Welcome.</h1><img src={icon} alt="Apparent"/><Button disabled>Sign in with Google</Button><p>Continue with local setup while sign-in is being connected.</p></div>}
    {state.step==='welcome'&&state.penPicker&&<><h1>Pick your pen.</h1><div className="native-pencils">{[['coral','#d94c44'],['purple','#7a58c7'],['blue','#3b79bd'],['green','#397b61']].map(([name,hex])=><button key={name} aria-label={`${name} pen`} aria-pressed={state.penSelected&&`rgb(${state.penRgb.join(',')})`===`rgb(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)})`} style={{'--pencil':hex} as React.CSSProperties} onClick={()=>void action(`pen:${name}`)}><span/>{name}</button>)}</div>{state.penError&&<p role="alert">The colour could not be saved. Try choosing it again.</p>}</>}
    {state.step==='how-it-works'&&<><h1>Show what you mean.</h1><p>Record your screen, talk, and draw. Then paste your capture into the agent you already use.</p><div className="native-explain"><img src={frog} alt=""/><p>You’ll try it on your own screen in a moment.</p></div></>}
    {state.step==='permissions'&&<><h1>One permission at a time.</h1><p>Start with Screen & System Audio Recording. Enable Apparent in the screen recording section, above audio only.</p><div className="native-permissions">{state.rows.map(row=><div key={row.permission}><div><strong>{permissionNames[row.permission]}</strong>{!row.required&&<small>Optional</small>}</div>{row.reopening?<span>Reopening Apparent…</span>:row.status==='granted'&&!row.relaunch?<span className="native-granted">✓ Enabled</span>:<Button variant="outline" onClick={()=>void action(`grant:${row.permission}`)}>{row.relaunch?'Reopen Apparent':'Open Settings'}</Button>}</div>)}</div></>}
    {state.step==='shortcut'&&<><h1>Start and stop with your shortcut.</h1><p>Choose the keys you’ll use for the practice capture.</p><div className="native-shortcut"><kbd>{state.shortcut}</kbd><Button variant="outline" onClick={()=>void action('change-shortcut')}>Change shortcut</Button></div><p>The native recorder checks and saves your key combination.</p></>}
    {state.step==='done'&&<><h1>Ready for your next idea.</h1><div className="native-explain"><img src={frog} alt=""/></div><p>Apparent stays in the menu bar, ready when you are.</p></>}
    {error&&<p role="alert">{error}</p>}
    </section><footer><Button variant="ghost" onClick={()=>void action('back')} disabled={state.index===0}>Back</Button><span>{state.index+1} / {state.count}</span><Button onClick={()=>void action('continue')} disabled={(state.step==='welcome'&&state.penPicker&&!state.penSelected)||(state.step==='permissions'&&!state.ready)||(state.step==='shortcut'&&state.firstCaptureRequired&&!state.shortcutChosen)}>{state.step==='welcome'?(state.penPicker?'That’s my pen':'Continue locally'):state.step==='done'?'Finish setup':'Continue'}</Button></footer></main>;
}
