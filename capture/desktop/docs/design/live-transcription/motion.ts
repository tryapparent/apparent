interface DemoScene {
  fit: HTMLDivElement;
  pill: HTMLDivElement;
  text: HTMLSpanElement;
  line: HTMLDivElement;
  viewport: HTMLDivElement;
  finish: HTMLButtonElement;
  clock: HTMLSpanElement;
  bars: HTMLElement[];
  finished: boolean;
  dismissed: boolean;
}
interface Window {
  motionDemo: {
    pause(): void;
    play(): void;
    replay(): void;
    seek(count: number): unknown;
  };
}

const words="Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum".split(" ");
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
let paused=reduce, tick=0, start=performance.now(), pauseStart=0, pausedTotal=0, loop=0;
const scenes: DemoScene[]=[...document.querySelectorAll<HTMLDivElement>(".fit")].map(f=>({fit:f,pill:f.querySelector<HTMLDivElement>(".pill")!,text:f.querySelector<HTMLSpanElement>(".words")!,line:f.querySelector<HTMLDivElement>(".line")!,viewport:f.querySelector<HTMLDivElement>(".caption-viewport")!,finish:f.querySelector<HTMLButtonElement>(".finish")!,clock:f.querySelector<HTMLSpanElement>(".clock")!,bars:[...f.querySelectorAll<HTMLElement>(".wave i")],finished:false,dismissed:false}));
function fit(){scenes.forEach(s=>{const width=s.pill.querySelector<HTMLDivElement>(".controls")!.offsetWidth;s.fit.style.width="min("+width+"px,100%)";s.pill.style.width=width+"px";const scale=Math.min(1,s.fit.clientWidth/width);s.pill.style.setProperty("--scale",scale);s.fit.style.height=(94*scale)+"px";position(s)})}
function position(s: DemoScene){const overflow=Math.max(0,s.line.scrollWidth-s.viewport.clientWidth);s.line.style.setProperty("--shift",(-overflow)+"px");s.viewport.dataset.overflow=String(overflow>2)}
function paint(count: number,elapsed=0){scenes.forEach(s=>{if(s.finished||s.dismissed)return;s.text.textContent=words.slice(0,count).join(" ");s.clock.textContent="0:"+String(18+Math.floor(elapsed)).padStart(2,"0");s.bars.forEach((b,i)=>b.style.setProperty("--bar",(paused?3:3+Math.abs(Math.sin(elapsed*5+i*1.4))*20)+"px"));position(s)})}
function setPaused(value: boolean){if(value===paused)return;if(value)pauseStart=performance.now();else pausedTotal+=performance.now()-pauseStart;paused=value;document.querySelector<HTMLButtonElement>("#pause")!.textContent=paused?"Play":"Pause";scenes.forEach(s=>s.pill.dataset.paused=String(paused))}
function reset(){start=performance.now();pausedTotal=0;pauseStart=0;loop=0;scenes.forEach(s=>{s.finished=false;s.dismissed=false;s.fit.dataset.dismissed="false";s.pill.dataset.finished="false";s.finish.querySelector<HTMLSpanElement>("span")!.textContent="Finish";s.finish.disabled=false});paused=false;document.querySelector<HTMLButtonElement>("#pause")!.textContent="Pause";scenes.forEach(s=>s.pill.dataset.paused="false");paint(0);document.querySelector<HTMLSpanElement>("#status")!.textContent="Simulation restarted."}
function finish(s: DemoScene){s.finished=true;s.pill.dataset.finished="true";s.finish.querySelector<HTMLSpanElement>("span")!.textContent="Finished";s.finish.disabled=true;s.bars.forEach(b=>b.style.setProperty("--bar","3px"));document.querySelector<HTMLSpanElement>("#status")!.textContent="Simulation finished."}
scenes.forEach(s=>{s.finish.addEventListener("click",()=>finish(s));s.fit.querySelector<HTMLButtonElement>(".close")!.addEventListener("click",()=>{s.dismissed=true;s.fit.dataset.dismissed="true";document.querySelector<HTMLSpanElement>("#status")!.textContent="Demo dismissed. Use Replay to restore."})});
document.querySelector<HTMLButtonElement>("#pause")!.addEventListener("click",()=>setPaused(!paused));document.querySelector<HTMLButtonElement>("#replay")!.addEventListener("click",reset);
function frame(now: number){if(!paused){const elapsed=(now-start-pausedTotal)/1000,period=words.length*.32+2,cycle=Math.floor(elapsed/period),t=elapsed%period;if(cycle!==loop){loop=cycle;scenes.forEach(s=>{if(!s.finished&&!s.dismissed){s.line.style.transition="none";s.text.textContent="";position(s);requestAnimationFrame(()=>s.line.style.transition="")}})}paint(Math.min(words.length,Math.floor(t/.32)),t)}tick=requestAnimationFrame(frame)}
document.fonts.ready.then(fit);new ResizeObserver(fit).observe(document.querySelector<HTMLElement>("main")!);fit();paint(reduce?23:0);if(reduce){document.querySelector<HTMLButtonElement>("#pause")!.textContent="Play";pauseStart=performance.now();scenes.forEach(s=>s.pill.dataset.paused="true")}tick=requestAnimationFrame(frame);
window.motionDemo={pause:()=>setPaused(true),play:()=>setPaused(false),replay:reset,seek:(count: number)=>{setPaused(true);paint(count,count*.32);return scenes.map(s=>({text:s.text.textContent,shift:s.line.style.getPropertyValue("--shift"),bounds:s.pill.getBoundingClientRect().toJSON()}))}};
if(document.body.dataset.qa){cancelAnimationFrame(tick);paused=false;paint(2,1);const before=scenes[0].pill.getBoundingClientRect();paint(40,13);const after=scenes[0].pill.getBoundingClientRect();console.assert(before.x===after.x&&before.width===after.width,"Pill moved");console.assert(scenes.every(s=>s.viewport.dataset.overflow==="true"),"No overflow");document.querySelector<HTMLButtonElement>("#pause")!.click();console.assert(paused,"Pause failed");scenes[0].finish.click();console.assert(scenes[0].finished&&scenes[0].finish.textContent.includes("Finished"),"Finish failed");document.querySelector<HTMLButtonElement>("#replay")!.click();console.assert(scenes.every(s=>!s.finished),"Replay failed");setPaused(true);paint(40,13);console.assert(document.documentElement.scrollWidth<=innerWidth,"Page overflow");console.log("QA passed: fixed pill, overflow fade, Pause, Finish, Replay, page bounds");}
