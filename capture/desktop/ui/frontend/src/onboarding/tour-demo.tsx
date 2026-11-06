import { useEffect, useRef, useState } from 'react';
import { Button } from '@apparent/ui/button';
import './tour-demo.css';

type Phase = 'record' | 'mark' | 'paste' | 'fixed';
/** Shared version of OnboardingDemo.swift's record → point → paste → fix story.
 * This is a demonstration: it never sends shortcuts or starts a capture. */
export function TourDemo({ onWatched }: { onWatched: () => void }) {
  const [phase, setPhase] = useState<Phase>('record');
  const [replay, setReplay] = useState(0);
  const report = useRef(onWatched);
  report.current = onWatched;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    setPhase('record');
    if (reduced) return;
    const schedule: [number, Phase][] = [[2600, 'mark'], [6000, 'paste'], [9000, 'fixed']];
    const timers = schedule.map(([ms, next]) => setTimeout(() => setPhase(next), ms));
    timers.push(setTimeout(() => report.current(), 10400));
    return () => timers.forEach(clearTimeout);
  }, [replay, reduced]);
  const phases: Phase[] = ['record', 'mark', 'paste', 'fixed'];
  const captions: Record<Phase, string> = {
    record: 'Record what you see and say.', mark: 'Point out what needs changing.',
    paste: 'Paste the capture into your agent.', fixed: 'Your agent sees the context and makes the change.',
  };
  return <div className="native-tour-demo" data-phase={phase} data-reduced={reduced}>
    <div className="tour-demo-stage" aria-label="Animated example of recording a misplaced button and sending it to an agent">
      <div className="tour-demo-page"><div className="tour-demo-bar">Your app</div><div className="tour-demo-checkout"><strong>Order summary</strong><span>One good idea</span><span>Total <b>€24</b></span><div className="tour-demo-pay">Pay</div><svg className="tour-demo-ink" viewBox="0 0 260 160" aria-hidden="true"><path pathLength="1" d="M174 104C159 68 251 67 254 106S168 145 174 104"/></svg></div></div>
      <div className="tour-demo-pill" aria-hidden="true"><span className="tour-demo-dot"/> {phase==='record'||phase==='mark'?'Recording':'Copied'} <span>{phase==='record'||phase==='mark'?'■ Finish':'✓'}</span></div>
      <div className="tour-demo-agent"><div className="tour-demo-bar">Your agent</div><div className="tour-demo-message"><strong>1 capture</strong><p>This button is cut off. Line it up with the total.</p></div><div className="tour-demo-reply">Moved the button back in line.</div></div>
      <span className="tour-demo-pointer" aria-hidden="true">↖</span>
    </div>
    <p aria-live="polite">{captions[phase]}</p>
    {reduced ? <div className="tour-demo-stills" aria-label="Demo scenes">{phases.map((next, index) => <Button key={next} variant="outline" aria-pressed={phase===next} onClick={() => { setPhase(next); if(next==='fixed') report.current(); }}>{index+1}. {next==='record'?'Record':next==='mark'?'Point':next==='paste'?'Paste':'Fix'}</Button>)}</div> : <Button variant="ghost" onClick={() => setReplay(value => value+1)}>Replay demo</Button>}
  </div>;
}
