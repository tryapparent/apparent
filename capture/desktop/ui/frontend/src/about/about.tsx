import { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Copy, ExternalLink, LoaderCircle, Star } from 'lucide-react';
import availableFrog from '../../../../assets/settings/frog-jump.png';
import currentFrog from '../../../../assets/settings/frog-lounge.png';
import failedFrog from '../../../../assets/settings/frog-puzzled.png';
import { Button } from '@apparent/ui/button';
import { NativeSelect, NativeSelectOption } from '@apparent/ui/native-select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@apparent/ui/tooltip';

export interface AboutState {
  version: string;
  updates: boolean;
  linux: boolean;
  mainUpdates: boolean;
  updateChannel: string;
  updateCheck: { checking: boolean; result: 'available' | 'current' | 'failed' | null };
}
type Action = { action: string; key?: string; value?: string };
declare global {
  interface Window {
    apparentAbout: {
      read(): Promise<AboutState | undefined>;
      act(action: Action): Promise<void>;
      subscribe(callback: (state: AboutState) => void): () => void;
      link(link: 'website' | 'source'): Promise<void>;
      copyVersion(): Promise<void>;
    };
  }
}
export function About() {
  const [state, setState] = useState<AboutState>();
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    let live = true;
    let received = false;
    const unsubscribe = window.apparentAbout.subscribe(value => { received = true; if (live) setState(value); });
    void window.apparentAbout.read().then(value => { if (live && !received && value) setState(value); })
      .catch(() => { if (live) setError('Unable to read update status. Reopen Settings to try again.'); });
    return () => { live = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (copyStatus !== 'copied') return;
    const timer = setTimeout(() => setCopyStatus('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copyStatus]);
  async function copyVersion() {
    if (!state) return;
    try { await window.apparentAbout.copyVersion(); setCopyStatus('copied'); }
    catch { setCopyStatus('failed'); }
  }
  async function act(action: Action) {
    setError('');
    try { await window.apparentAbout.act(action); }
    catch { setError('Unable to complete that action. Please try again.'); }
  }
  async function open(link: 'website' | 'source') {
    try { await window.apparentAbout.link(link); }
    catch { setError('Unable to open that link. Please try again.'); }
  }
  const result = state?.updateCheck.result;
  const checking = state?.updateCheck.checking;
  const title = checking ? 'Checking for updates…' : !state?.updates ? 'Updates unavailable'
    : result === 'available' ? 'Update available' : result === 'current' ? 'No update available'
    : result === 'failed' ? 'Update check failed' : null;
  // Results are inline. Native button activation owns Enter/Space so a focused
  // link, copy or tour action cannot accidentally accept an available update.
  useEffect(() => {
    if (!result) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) void act({ action: 'dismiss-update-check' });
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [result]);
  return <section aria-label="About Apparent" className="settings-about">
    {!state && <p role="status">Loading update status…</p>}
    {error && <p role="alert">{error}</p>}
    {state && <>
      <section className="settings-identity" aria-label="Build identity">
        <h2>apparent</h2>
        <div className="settings-version"><span className="select-text">Version {state.version}</span>
          <TooltipProvider><Tooltip><TooltipTrigger asChild>
            <Button variant="secondary" size="icon" className="settings-copy" aria-label="Copy version" onClick={() => void copyVersion()}>
              {copyStatus === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </Button>
          </TooltipTrigger><TooltipContent className="settings-help-content">Copy version</TooltipContent></Tooltip></TooltipProvider>
          <span role="status" className="settings-metadata">{copyStatus === 'copied' ? 'Copied' : copyStatus === 'failed' ? 'Unable to copy. Try again.' : ''}</span>
        </div>
      </section>
      <section className="settings-updates" aria-label="Update check" data-idle={!title || undefined}>
        <div className="settings-update-text">
          <div className="settings-result" role="status">{title && <>
            {checking ? <LoaderCircle className="settings-spin" aria-hidden="true" /> : result === 'failed' ? <AlertCircle className="text-destructive" aria-hidden="true" /> : result && <CheckCircle2 className="text-success" aria-hidden="true" />}
            <h3>{title}</h3>
          </>}</div>
          {!state.updates && <p className="settings-metadata">{state.linux ? 'Update checks work when Apparent runs from an AppImage.' : 'Updates work in the installed Apparent.app.'}</p>}
          {result === 'failed' && !checking && <p className="settings-metadata">Try checking again.</p>}
          <div className="settings-actions">
            {result === 'available' && !checking ? <>
              <Button onClick={() => void act({ action: 'update-now' })}>Update now</Button>
              <Button variant="secondary" onClick={() => void act({ action: 'update-later' })}>Update later</Button>
            </> : <Button disabled={!state.updates || checking} onClick={() => void act({ action: 'check-for-updates' })}>
              {checking ? 'Checking…' : result === 'failed' ? 'Try again' : result ? 'Check again' : 'Check for updates'}
            </Button>}
          </div>
        </div>
        {result && !checking && <img className="settings-frog" src={result === 'available' ? availableFrog : result === 'current' ? currentFrog : failedFrog} alt="" />}
      </section>
      {state.linux && state.mainUpdates && <div className="settings-channel"><label htmlFor="update-channel">Update channel</label>
        <NativeSelect id="update-channel" value={state.updateChannel} disabled={checking} onChange={event => void act({ action: 'set', key: 'updateChannel', value: event.target.value })}>
          <NativeSelectOption value="stable">Stable releases</NativeSelectOption><NativeSelectOption value="main">Latest main</NativeSelectOption>
        </NativeSelect>
      </div>}
    </>}
    <section className="settings-support" aria-label="Support apparent">
      <Button variant="link" asChild><a href="https://github.com/tryapparent/apparent" onClick={event => { event.preventDefault(); void open('source'); }}><Star aria-hidden="true" />Star on GitHub <ExternalLink aria-hidden="true" /></a></Button>
      <p className="settings-metadata">A GitHub star won’t fix your bugs, but it will make our day.</p>
    </section>
    <div className="settings-links">
      <Button variant="link" asChild><a href="https://app.tryapparent.com" onClick={event => { event.preventDefault(); void open('website'); }}>Website <ExternalLink aria-hidden="true" /></a></Button>
      <Button variant="link" asChild><a href="https://github.com/tryapparent/apparent" onClick={event => { event.preventDefault(); void open('source'); }}>Source code <ExternalLink aria-hidden="true" /></a></Button>
    </div>
    <Button variant="secondary" className="settings-tour" onClick={() => void act({ action: 'tour' })}>Show welcome tour</Button>
  </section>;
}
