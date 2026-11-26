import {useLayoutEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {Switch} from '@apparent/ui/switch';
import {ErrorDialog} from '@apparent/ui/error-dialog';
import frog from '../../../../../assets/settings/frog-puzzled.png';
import {enabled, sharingEnabled, wisprEnabled, type LabsFacts, type LabsSetting} from './policy';
import {bindPreference} from '../../../../../../../shared/settings/binding';

declare global {interface Window {apparentLabs: {
  read(): Promise<LabsFacts>; save(...command: [value: boolean, setting?: LabsSetting] | [value: undefined, setting: undefined, intent: unknown]): Promise<LabsFacts>;
  subscribe(callback: (facts: LabsFacts) => void): () => void;
};}}
const controls: Record<Exclude<LabsSetting, 'frogWardrobe'>, string> = {streaming: 'local-stream-toggle', pushToTalk: 'push-to-talk-toggle', sharing: 'public-sharing-toggle', wisprFlow: 'wispr-lab-toggle', dictationFrog: 'dictation-frog-toggle', desktopFrog: 'desktop-frog-toggle', speakingStyle: 'speaking-style-toggle', videoTracing: 'video-tracing-toggle', recordingPerformance: 'recording-performance-toggle'};
type LabsExperiment = React.ComponentType<{
  id: string; checked: boolean; disabled: boolean; saving: boolean;
  onCheckedChange: (value: boolean) => void;
}>;
type PushToTalkExperiment = React.ComponentType<React.ComponentProps<LabsExperiment> & {supported?: boolean}>;
export function Labs({openRouterExperiment: OpenRouter, speakingStyleExperiment: SpeakingStyle, videoTracingExperiment: VideoTracing, frogExperiment: FrogNudge, desktopFrogExperiment: DesktopFrog, pushToTalkExperiment: PushToTalk}: {
  speakingStyleExperiment?: LabsExperiment;
  videoTracingExperiment?: LabsExperiment;
  frogExperiment?: LabsExperiment;
  desktopFrogExperiment?: LabsExperiment;
  pushToTalkExperiment?: PushToTalkExperiment;
} & {openRouterExperiment?: React.ComponentType}) {
  const [facts, setFacts] = useState<LabsFacts>();
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [setting, setSetting] = useState<Exclude<LabsSetting, 'frogWardrobe'>>('streaming'), [operation, setOperation] = useState<'read' | 'save'>('read');
  const alive = useRef(true), pending = useRef(false), restoreFocus = useRef<string | null>(null);
  const wisprSupported = useRef(false);
  async function request(value?: boolean, setting: Exclude<LabsSetting, 'frogWardrobe'> = 'streaming') {
    if (pending.current) return;
    if (value !== undefined) {
      const active = document.activeElement;
      restoreFocus.current = active?.matches('.settings-labs button[role="switch"]:focus-visible') ? active.id : null;
    }
    pending.current = true; setBusy(true); setSetting(setting); setOperation(value === undefined ? 'read' : 'save');
    try {
      const next = await (value === undefined ? window.apparentLabs.read() : window.apparentLabs.save(value, setting));
      if (!alive.current) return;
      if (next.wisprSupported !== undefined) wisprSupported.current = next.wisprSupported;
      setFacts(next); setError(next.error ? 'Refresh the saved value, then try again.' : '');
    } catch {if (alive.current) {setFacts(undefined); setError('The app did not confirm this preference. Refresh to check the saved value.');}}
    finally {pending.current = false; if (alive.current) setBusy(false);}
  }
  useLayoutEffect(() => {
    alive.current = true;
    const unsubscribe = window.apparentLabs.subscribe(next => {
      if (alive.current && !pending.current) {
      if (next.wisprSupported !== undefined) wisprSupported.current = next.wisprSupported;
        setFacts(next); setError(next.error ? 'Unable to read this experiment. Refresh to try again.' : '');
      }
    });
    void request(); return () => {alive.current = false; unsubscribe();};
  }, []);
  useLayoutEffect(() => {
    if (busy || !restoreFocus.current) return;
    const target = document.getElementById(restoreFocus.current) as HTMLButtonElement | null;
    restoreFocus.current = null;
    if (!facts?.error && target && !target.disabled && document.hasFocus() && document.activeElement === document.body)
      target.focus({preventScroll: true});
  }, [busy, facts]);
  const on = facts && enabled(facts);
  const sharing = facts && sharingEnabled(facts);
  const wispr = facts && wisprEnabled(facts);
  const switchProps = (name: Exclude<LabsSetting, 'frogWardrobe'>, saved: boolean | null | undefined) => ({
    id: controls[name],
    checked: saved === true,
    disabled: busy || !facts || !!facts.error,
    saving: busy && setting === name,
  });
  return <section className="settings-labs" aria-label="Experimental features">
    <section className="agent-preference">
      <div className="agent-preference-row"><h2 className="settings-preference-label" id="local-stream-label" tabIndex={-1}>Live local transcription</h2>
        <Switch id={controls.streaming} className="agent-switch" checked={on ?? false} aria-labelledby="local-stream-label" aria-describedby="local-stream-help local-stream-ready" aria-busy={busy && setting === 'streaming'}
          disabled={busy || on === undefined} onCheckedChange={bindPreference('labs', 'labs.localStreamingTranscription', value => void request(value))} /></div>
      <p id="local-stream-help">See a live preview of your English speech below the recording controls. The saved transcript is generated separately on this computer.</p>
      <p id="local-stream-ready">Enabling downloads any missing speech models. Live text starts on the next recording after the models are ready.</p>
    </section>
    {OpenRouter && <OpenRouter />}
    {SpeakingStyle && <SpeakingStyle {...switchProps('speakingStyle', facts?.speakingStyleSaved)} onCheckedChange={bindPreference('labs', 'labs.speakingStyle', value => void request(value, 'speakingStyle'))} />}
    {VideoTracing && <VideoTracing {...switchProps('videoTracing', facts?.videoTracingSaved)} onCheckedChange={bindPreference('labs', 'labs.videoTracing', value => void request(value, 'videoTracing'))} />}
    {PushToTalk && <PushToTalk {...switchProps('pushToTalk', facts?.pushToTalkSaved)}
      supported={facts?.pushToTalkSupported} onCheckedChange={bindPreference('labs', 'labs.pushToTalk', value => void request(value, 'pushToTalk'))} />}
    <section className="agent-preference">
      <div className="agent-preference-row"><h2 className="settings-preference-label" id="public-sharing-label" tabIndex={-1}>Public sharing links</h2>
        <Switch id={controls.sharing} className="agent-switch" checked={sharing ?? false} aria-labelledby="public-sharing-label" aria-describedby="public-sharing-help public-sharing-limits" aria-busy={busy && setting === 'sharing'}
          disabled={busy || sharing === undefined} onCheckedChange={bindPreference('labs', 'labs.hostedSharing', value => void request(value, 'sharing'))} /></div>
      <p id="public-sharing-help">Show Public link after your next recording.</p>
      <p id="public-sharing-limits">Anyone with the link can view the shared capture. Shared captures are not end-to-end encrypted.</p>
    </section>
    <section className="agent-preference">
      <div className="agent-preference-row"><h2 className="settings-preference-label" id="wispr-lab-label">Dictation app conflicts</h2>
        <Switch id={controls.wisprFlow} className="agent-switch" checked={wispr ?? false} aria-labelledby="wispr-lab-label" aria-describedby="wispr-lab-help" aria-busy={busy && setting === 'wisprFlow'}
          disabled={busy || wispr === undefined || !wisprSupported.current} onCheckedChange={bindPreference('labs', 'labs.onboardingWisprFlow', value => void request(value, 'wisprFlow'))} /></div>
      <p id="wispr-lab-help">Offer to quit Wispr Flow or Superwhisper before choosing a recording shortcut. macOS only.</p>
    </section>
    {DesktopFrog && typeof facts?.desktopFrogSaved === 'boolean' && <DesktopFrog {...switchProps('desktopFrog', facts?.desktopFrogSaved)}
      onCheckedChange={bindPreference('labs', 'labs.desktopFrog', value => void request(value, 'desktopFrog'))} />}
    {FrogNudge && wisprSupported.current && <FrogNudge {...switchProps('dictationFrog', facts?.dictationFrogSaved)} onCheckedChange={bindPreference('labs', 'labs.dictationFrog', value => void request(value, 'dictationFrog'))} />}
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="recording-performance-label">Share performance metrics</h2>
        <Switch id={controls.recordingPerformance} className="agent-switch"
          checked={facts?.recordingPerformanceSaved === true}
          aria-labelledby="recording-performance-label" aria-describedby="recording-performance-help"
          aria-busy={busy && setting === 'recordingPerformance'}
          disabled={busy || !facts || !!facts.error}
          onCheckedChange={bindPreference('labs', 'labs.recordingPerformance', value => void request(value, 'recordingPerformance'))} />
      </div>
      <p id="recording-performance-help">Send detailed startup and save timings for screen recordings to PostHog, along with your app build, operating system, and recording-length range.</p>
    </section>
    <span role="status" className="sr-only">{busy ? operation === 'save' ? 'Saving preference' : 'Reading saved preference' : ''}</span>
    {(!facts || facts.error) && !busy && !error && <Button id="labs-refresh" variant="secondary" onClick={() => void request(undefined, setting)}>Refresh preference</Button>}
    <ErrorDialog open={!!error} title={!facts ? 'Preference not confirmed' : facts.error === 'config_read_failed' ? 'Unable to read preference' : 'Unable to save preference'} description={error} artwork={<img src={frog} alt="" />} recoveryLabel="Refresh preference" busy={busy}
      restoreFocus={() => {const target = document.getElementById(controls[setting]) as HTMLButtonElement | null; (target && !target.disabled ? target : document.getElementById('labs-refresh'))?.focus();}}
      onRecover={() => void request(undefined, setting)} onClose={() => setError('')} />
  </section>;
}
