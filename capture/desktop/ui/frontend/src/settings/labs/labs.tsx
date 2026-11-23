import {useEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {Switch} from '@apparent/ui/switch';
import {ErrorDialog} from '@apparent/ui/error-dialog';
import frog from '../../../../../assets/settings/frog-puzzled.png';
import {enabled, autoPasteEnabled, sharingEnabled, wisprEnabled, type LabsFacts, type LabsSetting} from './policy';
import type {ComponentType} from 'react';

declare global {interface Window {apparentLabs: {
  read(): Promise<LabsFacts>; save(value: boolean, setting?: LabsSetting): Promise<LabsFacts>;
  subscribe(callback: (facts: LabsFacts) => void): () => void;
};}}
const controls: Record<LabsSetting, string> = {streaming: 'local-stream-toggle', autoPaste: 'auto-paste-toggle', pushToTalk: 'push-to-talk-toggle', sharing: 'public-sharing-toggle', wisprFlow: 'wispr-lab-toggle', dictationFrog: 'dictation-frog-toggle', agentContext: 'agent-context-toggle', speakingStyle: 'speaking-style-toggle', pillDoodles: 'pill-doodles-toggle', recordingPerformance: 'recording-performance-toggle'};
export type LabsExperiment<Checked = boolean> = ComponentType<{
  id: string; checked: Checked; disabled: boolean; saving: boolean;
  access?: LabsFacts['agentContextAccess'];
  onCheckedChange: (value: boolean) => void;
}>;
export type AutoPasteExperiment = ComponentType<React.ComponentProps<LabsExperiment> & {supported: boolean}>;
export type PushToTalkExperiment = ComponentType<React.ComponentProps<LabsExperiment> & {supported?: boolean}>;
export function Labs({speakingStyleExperiment: SpeakingStyle, frogExperiment: FrogNudge, agentContextExperiment: AgentContext, autoPasteExperiment: AutoPaste, pushToTalkExperiment: PushToTalk, pillDoodlesExperiment: PillDoodles}: {
  speakingStyleExperiment?: LabsExperiment;
  frogExperiment?: LabsExperiment;
  agentContextExperiment?: LabsExperiment;
  autoPasteExperiment?: AutoPasteExperiment;
  pushToTalkExperiment?: PushToTalkExperiment;
  pillDoodlesExperiment?: LabsExperiment<boolean | null | undefined>;
}) {
  const [facts, setFacts] = useState<LabsFacts>();
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [setting, setSetting] = useState<LabsSetting>('streaming'), [operation, setOperation] = useState<'read' | 'save'>('read');
  const alive = useRef(true), pending = useRef(false);
  const restoreFocus = useRef<string | null>(null);
  const autoPasteSupported = useRef(false), wisprSupported = useRef(false);
  async function request(value?: boolean, setting: LabsSetting = 'streaming') {
    if (pending.current) return;
    if (value !== undefined) {
      const active = document.activeElement;
      restoreFocus.current = active?.matches('.settings-labs button[role="switch"]:focus-visible') ? active.id : null;
    }
    pending.current = true; setBusy(true); setSetting(setting); setOperation(value === undefined ? 'read' : 'save');
    try {
      const next = await (value === undefined ? window.apparentLabs.read() : window.apparentLabs.save(value, setting));
      if (!alive.current) return;
      if (next.autoPasteSupported !== undefined) autoPasteSupported.current = next.autoPasteSupported;
      if (next.wisprSupported !== undefined) wisprSupported.current = next.wisprSupported;
      setFacts(next); setError(next.error ? 'Refresh the saved value, then try again.' : '');
    } catch {if (alive.current) {setFacts(undefined); setError('The app did not confirm this preference. Refresh to check the saved value.');}}
    finally {pending.current = false; if (alive.current) setBusy(false);}
  }
  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.apparentLabs.subscribe(next => {
      if (alive.current && !pending.current) {
        if (next.autoPasteSupported !== undefined) autoPasteSupported.current = next.autoPasteSupported;
      if (next.wisprSupported !== undefined) wisprSupported.current = next.wisprSupported;
        setFacts(next); setError(next.error ? 'Unable to read this experiment. Refresh to try again.' : '');
      }
    });
    void request(); return () => {alive.current = false; unsubscribe();};
  }, []);
  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    const target = document.getElementById(restoreFocus.current) as HTMLButtonElement | null;
    restoreFocus.current = null;
    if (!facts?.error && target && !target.disabled && document.hasFocus() && document.activeElement === document.body)
      target.focus({preventScroll: true});
  }, [busy, facts]);
  const on = facts && enabled(facts);
  const autoPaste = facts && autoPasteEnabled(facts);
  const sharing = facts && sharingEnabled(facts);
  const wispr = facts && wisprEnabled(facts);
  return <section className="settings-labs" aria-label="Experimental features">
    {AgentContext && <AgentContext id={controls.agentContext} checked={facts?.agentContextSaved === true}
      access={facts?.agentContextAccess}
      disabled={busy || !facts || !!facts.error} saving={busy && setting === 'agentContext'}
      onCheckedChange={value => void request(value, 'agentContext')} />}
    <section className="agent-preference">
      <div className="agent-preference-row"><h2 className="settings-preference-label" id="local-stream-label" tabIndex={-1}>Live local transcription</h2>
        <Switch id={controls.streaming} className="agent-switch" checked={on ?? false} aria-labelledby="local-stream-label" aria-describedby="local-stream-help local-stream-ready" aria-busy={busy && setting === 'streaming'}
          disabled={busy || on === undefined} onCheckedChange={value => void request(value)} /></div>
      <p id="local-stream-help">See a live preview of your English speech below the recording controls. The saved transcript is generated separately on this computer.</p>
      <p id="local-stream-ready">Enabling downloads any missing speech models. Live text starts on the next recording after the models are ready.</p>
    </section>
    {SpeakingStyle && <SpeakingStyle id={controls.speakingStyle} checked={facts?.speakingStyleSaved === true}
      disabled={busy || !facts || !!facts.error} saving={busy && setting === 'speakingStyle'}
      onCheckedChange={value => void request(value, 'speakingStyle')} />}
    {PushToTalk && <PushToTalk id={controls.pushToTalk} checked={facts?.pushToTalkSaved === true}
      supported={facts?.pushToTalkSupported} disabled={busy || !facts || !!facts.error}
      saving={busy && setting === 'pushToTalk'} onCheckedChange={value => void request(value, 'pushToTalk')} />}
    {PillDoodles && <PillDoodles id={controls.pillDoodles} checked={facts?.pillDoodlesSaved}
      disabled={busy || !facts || !!facts.error} saving={busy && setting === 'pillDoodles'}
      onCheckedChange={value => void request(value, 'pillDoodles')} />}
    {AutoPaste && <AutoPaste id={controls.autoPaste} checked={autoPaste ?? false} supported={autoPasteSupported.current}
      disabled={busy || autoPaste === undefined} saving={busy && setting === 'autoPaste'}
      onCheckedChange={value => void request(value, 'autoPaste')} />}
    <section className="agent-preference">
      <div className="agent-preference-row"><h2 className="settings-preference-label" id="public-sharing-label" tabIndex={-1}>Public sharing links</h2>
        <Switch id={controls.sharing} className="agent-switch" checked={sharing ?? false} aria-labelledby="public-sharing-label" aria-describedby="public-sharing-help public-sharing-limits" aria-busy={busy && setting === 'sharing'}
          disabled={busy || sharing === undefined} onCheckedChange={value => void request(value, 'sharing')} /></div>
      <p id="public-sharing-help">Show Public link after your next recording.</p>
      <p id="public-sharing-limits">Anyone with the link can view the shared capture. Shared captures are not end-to-end encrypted.</p>
    </section>
    <section className="agent-preference">
      <div className="agent-preference-row"><h2 className="settings-preference-label" id="wispr-lab-label">Dictation app conflicts</h2>
        <Switch id={controls.wisprFlow} className="agent-switch" checked={wispr ?? false} aria-labelledby="wispr-lab-label" aria-describedby="wispr-lab-help" aria-busy={busy && setting === 'wisprFlow'}
          disabled={busy || wispr === undefined || !wisprSupported.current} onCheckedChange={value => void request(value, 'wisprFlow')} /></div>
      <p id="wispr-lab-help">Offer to quit Wispr Flow or Superwhisper before choosing a recording shortcut. macOS only.</p>
    </section>
    {FrogNudge && wisprSupported.current && <FrogNudge id={controls.dictationFrog} checked={facts?.dictationFrogSaved ?? false}
      disabled={busy || !facts || !!facts.error} saving={busy && setting === 'dictationFrog'}
      onCheckedChange={value => void request(value, 'dictationFrog')} />}
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="recording-performance-label">Share recording performance</h2>
        <Switch id={controls.recordingPerformance} className="agent-switch"
          checked={facts?.recordingPerformanceSaved === true}
          aria-labelledby="recording-performance-label" aria-describedby="recording-performance-help"
          aria-busy={busy && setting === 'recordingPerformance'}
          disabled={busy || !facts || !!facts.error}
          onCheckedChange={value => void request(value, 'recordingPerformance')} />
      </div>
      <p id="recording-performance-help">Send start and save timings for each screen recording to PostHog, along with your app build, operating system, and recording-length range.</p>
    </section>
    <span role="status" className="sr-only">{busy ? operation === 'save' ? 'Saving preference' : 'Reading saved preference' : ''}</span>
    {(!facts || facts.error) && !busy && !error && <Button id="labs-refresh" variant="secondary" onClick={() => void request(undefined, setting)}>Refresh preference</Button>}
    <ErrorDialog open={!!error} title={!facts ? 'Preference not confirmed' : facts.error === 'config_read_failed' ? 'Unable to read preference' : 'Unable to save preference'} description={error} artwork={<img src={frog} alt="" />} recoveryLabel="Refresh preference" busy={busy}
      restoreFocus={() => {const target = document.getElementById(controls[setting]) as HTMLButtonElement | null; (target && !target.disabled ? target : document.getElementById('labs-refresh'))?.focus();}}
      onRecover={() => void request(undefined, setting)} onClose={() => setError('')} />
  </section>;
}
