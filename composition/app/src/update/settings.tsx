import * as React from 'react';
import { Button } from '@apparent/ui/button';
import type { UpdatePort, UpdateState } from './contract.ts';

export function UpdateSettings({ port }: { port: UpdatePort }) {
  const [state, set] = React.useState<UpdateState>();
  React.useEffect(() => {
    let active = true;
    const read = () => { void port.read().then(value => { if (active) set(value); }).catch(() => {}); };
    read(); const timer = setInterval(read, 1000);
    return () => { active = false; clearInterval(timer); };
  }, [port]);
  const busy = state?.phase === 'checking' || state?.phase === 'restarting';
  const enabled = !!state && !['unsupported', 'not-installed'].includes(state.phase);
  return <section aria-label="App updates">
    <h3>App updates</h3><p>Channel: <strong>Main</strong> · development builds</p>
    {state?.running && <p>Running build <code>{state.running.slice(0, 12)}</code></p>}
    <p role="status">{state?.message ?? 'Loading update status…'}</p>
    {state?.available && <p>Downloaded build <code>{state.available.slice(0, 12)}</code></p>}
    <Button disabled={!enabled || busy} onClick={() => { void port.check().then(set); }}>
      {state?.phase === 'checking' ? 'Checking…' : 'Check for updates'}</Button>{' '}
    {state?.phase === 'ready' && <Button onClick={() => { void port.restart().catch(() => port.read().then(set)); }}>Restart to update</Button>}
  </section>;
}
