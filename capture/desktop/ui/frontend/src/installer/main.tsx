import {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Button} from '@apparent/ui/button';
import icon from '../../../../../../shared/assets/brand/apparent-app-icon.svg';
import frog from '../../../../assets/onboarding/frog.png';
import '../style.css';
import './style.css';
type State = {needsReplacement?: boolean; version?: string; installed?: boolean; destination?: string; previousApp?: string};
declare global {interface Window {apparentInstaller: {action: (action: string, replace?: boolean) => Promise<State>}}}
function Installer() {
  const [state, setState] = useState<State>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [hop, setHop] = useState(false), [confirm, setConfirm] = useState(false);
  const replacement = useRef<HTMLButtonElement>(null);
  useEffect(() => {if (confirm) replacement.current?.focus();}, [confirm]);
  const image = useRef<HTMLImageElement>(null), active = useRef(false), generation = useRef(0);
  useEffect(() => { void refresh(); return () => {generation.current++;}; }, []);
  async function refresh() {try {setState(await window.apparentInstaller.action('status')); setError('');} catch (e) {setError(e instanceof Error ? e.message : 'The installer could not check Applications.');}}
  async function install(replace = false) {
    if (active.current || state?.installed) return;
    if (state?.needsReplacement && !replace) {setConfirm(true); return;}
    active.current = true; setBusy(true); setError(''); setConfirm(false);
    const run = ++generation.current;
    try {
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await image.current?.decode(); await document.fonts.ready;
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        if (run !== generation.current) return;
        const journey = image.current?.closest('.installer-journey');
        const destination = journey?.querySelector('.installer-applications')?.getBoundingClientRect();
        const origin = image.current?.getBoundingClientRect();
        if (destination && origin) (journey as HTMLElement).style.setProperty('--installer-hop-x', `${destination.x + destination.width / 2 - origin.x - origin.width / 2}px`);
        setHop(true);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const animation = image.current?.getAnimations().find(a => (a as CSSAnimation).animationName === 'installer-hop');
        if (animation) await animation.finished;
        await new Promise(resolve => setTimeout(resolve, 180));
      }
      const installed = await window.apparentInstaller.action('install', replace);
      if (run === generation.current) setState(installed);
    } catch (e) { if (run === generation.current) setError(e instanceof Error ? e.message : 'Installation did not finish. Your existing app was preserved.'); }
    finally {if (run === generation.current) {active.current = false; setBusy(false); setHop(false);}}
  }
  async function open() {try {await window.apparentInstaller.action('open');} catch(e) {setError(e instanceof Error ? e.message : 'Open apparent from Applications.');}}
  return <main className="installer"><header>apparent · installer</header><h1>{state?.installed ? 'Ready to make it apparent.' : 'A little hop to Applications.'}</h1>
    <p>{state?.installed ? 'apparent is installed in Applications.' : 'Drag the app onto Applications, or let the frog take it there.'}</p>
    <div className="installer-journey" data-hopping={hop}>
      <div className="installer-app" draggable={!busy && !!state && !state.installed} onDragStart={e => e.dataTransfer.setData('application/x-apparent-install','app')}><img src={icon} alt="apparent app"/><span>apparent</span></div>
      <Button className="installer-frog" variant="ghost" disabled={busy || !state || state.installed} aria-label="Install apparent in Applications" onClick={() => void install()}><img ref={image} src={frog} alt=""/></Button>
      <div className="installer-applications" role="group" aria-label="Applications install drop target" onDragOver={e => {if(e.dataTransfer.types.includes('application/x-apparent-install')) e.preventDefault();}} onDrop={e => {e.preventDefault(); if(e.dataTransfer.getData('application/x-apparent-install')==='app') void install();}}><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M4 12Q4 6 10 6H30L38 16H70Q76 16 76 22V54Q76 60 70 60H10Q4 60 4 54Z"/><path className="installer-folder-front" d="M4 26H76V54Q76 60 70 60H10Q4 60 4 54Z"/><path className="installer-folder-mark" d="M31 44L40 28L49 44M34 39H46M28 45H52"/></svg><strong>Applications</strong></div>
    </div>
    {confirm && <section role="alertdialog" aria-label="Replace existing apparent" aria-describedby="replace-description"><p id="replace-description">Replace the installed Apparent Preview? Finish recordings and quit it first. Its previous app bundle will be preserved; recordings and settings stay in their existing folders.</p><div className="installer-actions"><Button ref={replacement} onClick={() => void install(true)}>Replace app</Button><Button variant="outline" onClick={() => setConfirm(false)}>Keep existing app</Button></div></section>}
    {error && <p role="alert">{error}</p>}
    <footer>{state?.installed ? <><Button onClick={() => void open()}>Open apparent</Button>{state.previousApp && <p>Your previous app was kept at {state.previousApp}. To restore it in Finder, quit apparent, move the current app aside, then rename the backup to Apparent Preview.app.</p>}</> : <><Button disabled={busy || !state} onClick={() => void install()}>{busy ? 'Installing…' : 'Install apparent'}</Button>{error && <Button variant="outline" disabled={busy} onClick={() => void refresh()}>Check again</Button>}</>}<small>Opening this installer does not change your recording permissions.</small></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Installer/>);
