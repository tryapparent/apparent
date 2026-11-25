import { useSyncExternalStore } from 'react';
import { Button } from '@apparent/ui/button';
const unsubscribe = () => () => {};
const disconnected = () => '{"phase":"error","message":"Unable to connect to Apparent. Reopen Record for Hermes and try again."}';
export function HermesRecording() {
  const bridge = window.hermesRecording;
  const view: HermesRecordingView = JSON.parse(useSyncExternalStore(bridge?.subscribe ?? unsubscribe, bridge?.snapshot ?? disconnected));
  const captions = { confirm: 'Continue only if you started this from Hermes. Record your screen, voice and marks. Finish returns the recording to Hermes for the original conversation. Keep Hermes open.',
    starting: 'Starting Apparent. Complete any permission prompts in the app.', recording: 'Talk, point and draw. Finish or cancel using Apparent’s recording controls.',
    processing: 'Preparing your recording…', saved: 'Recording saved. Waiting for Hermes to accept it. Keep Hermes open.', cancelled: 'Recording cancelled. Nothing was sent.', error: view.message ?? 'Unable to record.' };
  return <main className="space-y-4 bg-background p-6 text-foreground"><h1 className="text-xl font-semibold">Record for Hermes</h1>
    <p role="status" className="text-sm text-muted-foreground">{captions[view.phase]}</p>
    {view.phase === 'confirm' && <Button disabled={view.availability !== 'checked'} onClick={() => { void bridge?.start(); }}>Record and send when finished</Button>}
    <p role="status" className="text-sm text-muted-foreground" hidden={view.phase !== 'confirm'}>{view.availability === 'pending' && 'Checking capture availability…'}</p>
    {view.bundlePath && <p className="break-all text-xs text-muted-foreground">Saved recording: {view.bundlePath}</p>}
    {view.phase === 'error' && <p className="text-sm">Any recording already started remains in Apparent. Nothing is retried automatically.</p>}
  </main>;
}
