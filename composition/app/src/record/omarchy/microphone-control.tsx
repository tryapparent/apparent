import * as React from 'react';
import { Button } from '@apparent/ui/button';
import { connectRecordClient } from '../renderer-client.ts';
import type { RecordClient } from '@apparent/record/capabilities';
import type { CapabilitySnapshot } from '@apparent/record/capabilities';
import type { RecordRendererPort } from '../wire.ts';
import type { MicrophoneRendererPort, MicrophoneReadiness } from './microphone-wire.ts';

/** Explicit action, not a persistent setting. The existing Record pill remains
 * the silent action and owns processing/Saved/Copy/transcript presentation. */
export function MicrophoneControl({ record, microphone }: {
  record: RecordRendererPort; microphone?: MicrophoneRendererPort;
}) {
  const [snapshot, setSnapshot] = React.useState<CapabilitySnapshot>();
  const [support, setSupport] = React.useState<MicrophoneReadiness>({ support: 'unavailable' });
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState<string>();
  const [message, setMessage] = React.useState('');
  React.useEffect(() => {
    let live = true;
    let client:RecordClient|undefined;let remove:(()=>void)|undefined;
    void connectRecordClient(record).then(value=>{
      if(!live){value.detach();return;}client=value;remove=value.observe(snapshot=>{if(live)setSnapshot(snapshot);});
    }).catch(()=>{});
    if (microphone) void microphone.read().then(value => { if (live) setSupport(value); }).catch(() => {});
    return () => { live = false; remove?.(); client?.detach(); };
  }, [record, microphone]);
  React.useEffect(() => {
    if (uncertain && snapshot?.captures.some(capture => (capture.captureId === uncertain || capture.invocationId === uncertain)
      && ['saved', 'failed', 'cancelled'].includes(capture.phase))) setUncertain(undefined);
  }, [snapshot, uncertain]);
  if (!microphone) return null;
  const active = snapshot?.captures.some(capture => ['starting', 'recording', 'processing', 'unknown'].includes(capture.phase));
  const blocked = pending || !!uncertain || !snapshot || snapshot.connection !== 'connected' || active;
  const check = async () => {
    if (blocked) return;
    setPending(true);
    try { setSupport(await microphone.read()); setMessage(''); }
    catch { setSupport({ support: 'unavailable' }); setMessage('Microphone readiness is unknown.'); }
    finally { setPending(false); }
  };
  const start = async () => {
    if (blocked || support.support !== 'available' || !snapshot) return;
    const requestId = globalThis.crypto.randomUUID();
    setPending(true); setMessage('Preparing microphone recording…');
    try {
      const result = await microphone.start({ type: 'start-capture', delivery: 'host-default', requestId,
        expected: { providerEpoch: snapshot.providerEpoch, revision: snapshot.revision } });
      // Provider observations already pass through the monotonic Record client.
      // A reply delivered after a newer observation must not roll the UI back.
      if (result.status === 'outcome-unknown') { setUncertain(requestId); setMessage('Recording request outcome is unknown. Check the recording status before trying again.'); }
      else if (result.status === 'refused') setMessage(result.reason);
      else if (result.status === 'cancelled') setMessage('Recording request cancelled.');
      else setMessage('');
    } catch {
      setUncertain(requestId);
      setMessage('Recording request outcome is unknown. Check the recording status before trying again.');
    } finally { setPending(false); }
  };
  return <section aria-label="Microphone recording">
    <Button disabled={!!blocked || support.support !== 'available'} onClick={() => void start()}>Record with microphone</Button>
    <Button variant="outline" disabled={!!blocked} onClick={() => void check()}>Check microphone</Button>
    {support.support !== 'available' && <p>Microphone recording is unavailable in this session.</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
