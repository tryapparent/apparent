import * as React from 'react';
import { Button } from '@apparent/ui/button';
import { onboardingContributionFactory, onboardingProgressCodec,
  type OnboardingHostedContribution, type OnboardingSurfaceSnapshot } from '@apparent/onboarding';
import type { JsonValue, OnboardingProgressPort } from '@apparent/app-contracts/host';
import type { RecordRendererPort } from '../record/wire.ts';
import { connectRecordClient } from '../record/renderer-client.ts';

type EntryPorts = {
  progress: OnboardingProgressPort;
  record: RecordRendererPort;
  openRecordingEntry(): Promise<boolean>;
};

/** One concrete owner result survives generic module binding. The host owns
 * visibility/native effects; this adapter selects only the existing surfaces. */
export async function createOnboardingEntry(ports: EntryPorts,
  surface: (value: OnboardingSurfaceSnapshot) => void, close: () => void) {
  const record = await connectRecordClient(ports.record);
  try {
    const contribution = await onboardingContributionFactory.create({
      Button, record, id: () => globalThis.crypto.randomUUID(), close,
      openRecordingEntry: () => ports.openRecordingEntry(), onSurfaceChange: surface,
      progress: {
        async read() {
          const result = await ports.progress.read();
          return { ...result, value: onboardingProgressCodec.decode(result.value as JsonValue) };
        },
        async compareAndSwap(expected, value) {
          const result = await ports.progress.compareAndSwap(expected, onboardingProgressCodec.encode(value));
          return result.status === 'conflict'
            ? { ...result, current: onboardingProgressCodec.decode(result.current as JsonValue) } : result;
        },
      },
    });
    let disposed = false;
    return {
      contribution,
      async dispose() {
        if (disposed) return;
        // Failed owner disposal remains retryable; detaching only our observer
        // never stops or replaces the main Record provider.
        await contribution.activation.dispose(); record.detach(); disposed = true;
      },
    };
  } catch (error) { record.detach(); throw error; }
}

export function OnboardingRecordEntry({ ports, children }: React.PropsWithChildren<{ ports: EntryPorts }>) {
  const [entry, setEntry] = React.useState<OnboardingHostedContribution>();
  const [surface, setSurface] = React.useState<OnboardingSurfaceSnapshot>({ kind: 'hidden' });
  const [phase, setPhase] = React.useState<'loading' | 'ready' | 'failed'>('loading');
  const [actionError, setActionError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    let owned: Awaited<ReturnType<typeof createOnboardingEntry>> | undefined;
    void createOnboardingEntry(ports, value => { if (active) setSurface(value); }, () => {
      if (active) setSurface({ kind: 'hidden' });
    }).then(async value => {
      owned = value;
      if (!active) { await value.dispose(); return; }
      setEntry(value.contribution);
      await value.contribution.activation.activate({ reason: 'firstLaunch' });
      if (active) setPhase('ready');
    }).catch(() => { if (active) setPhase('failed'); });
    return () => { active = false; if (owned) void owned.dispose().catch(() => {}); };
  }, [ports]);
  const activate = (replay: boolean) => {
    if (!entry || phase !== 'ready' || busy) return;
    setBusy(true); setActionError(false);
    void (replay ? entry.activation.replayTour() : entry.activation.activate({ reason: 'resume' }))
      .catch(() => setActionError(true)).finally(() => setBusy(false));
  };
  if (phase === 'loading') return <p role="status">Checking saved setup…</p>;
  if (phase === 'failed') return <>
    <p role="alert">Setup could not open. Existing progress and recording ownership are preserved.</p>
    {entry ? <Button onClick={() => {
      setPhase('loading');
      void entry.activation.activate({ reason: 'firstLaunch' }).then(() => setPhase('ready'), () => setPhase('failed'));
    }}>Read setup again</Button> : <p>Reopen Apparent after resolving the startup issue.</p>}
  </>;
  return <>
    {surface.kind === 'hidden' ? <>
      {children}
      <nav aria-label="Setup"><Button disabled={busy} onClick={() => activate(false)}>Resume setup</Button>
        <Button disabled={busy} onClick={() => activate(true)}>Replay welcome tour</Button></nav>
    </> : entry ? <entry.module.Screen /> : null}
    {actionError ? <p role="alert">Setup could not be opened. Existing progress is preserved.</p> : null}
  </>;
}
