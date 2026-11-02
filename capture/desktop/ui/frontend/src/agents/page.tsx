import { useEffect, useRef, useState } from 'react';
import { Button } from '@apparent/ui/button';
import type { AgentsResult } from '../bridge';

const labels = {
  unavailable: 'Open the installed app to manage the command-line tool.',
  installed: 'The command-line tool is installed.', managed: 'Homebrew manages this command. Use Homebrew to uninstall it.',
  missing: 'The command-line tool is not installed.', stale: 'The command points to an older app. Install to update it.',
  taken: 'Another program owns this command. Apparent will leave it alone.', nowhere: 'No writable installation folder is available.',
};
export function AgentsSettings() {
  const [result, setResult] = useState<AgentsResult>({ status: 'disconnected' });
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const order = useRef(0);
  async function request(action: 'read' | 'install' | 'uninstall' | 'demo' = 'read', enabled?: boolean) {
    const token = ++order.current;
    setBusy(true);
    try {
      const b = window.apparent;
      const next = !b ? { status: 'disconnected' as const } : action === 'read' ? await b.readAgents() :
        action === 'install' ? await b.installCli() : action === 'uninstall' ? await b.uninstallCli() : await b.setAgentDemoVideo(enabled!);
      if (token !== order.current) return;
      setResult(next);
      setNeedsRefresh(next.status !== 'connected');
    } catch {
      if (token === order.current) { setResult({ status: 'error', code: 'bridge_failed' }); setNeedsRefresh(true); }
    } finally { if (token === order.current) setBusy(false); }
  }
  useEffect(() => { void request(); return () => { order.current++; }; }, []);
  return <section aria-labelledby="agents-title" className="space-y-4 rounded-xl border border-border bg-surface p-6">
    <h2 id="agents-title" className="text-lg font-semibold">Agents</h2>
    <Button variant="outline" disabled={busy} onClick={() => void request()}>Refresh Agents settings</Button>
    <div role="status" aria-live="polite">{busy ? 'Checking Agents settings…' : result.status === 'connected' ? labels[result.agents.cli] :
      result.status === 'error' ? 'Could not confirm the saved state. Refresh before trying again.' : 'Open Apparent and refresh to connect.'}</div>
    {result.status === 'connected' && <>
      <div className="flex gap-3">
        <Button disabled={busy || needsRefresh || !result.agents.canInstall} onClick={() => void request('install')}>Install command-line tool</Button>
        <Button variant="outline" disabled={busy || needsRefresh || !result.agents.canUninstall} onClick={() => void request('uninstall')}>Uninstall command-line tool</Button>
      </div>
      <h3 className="font-medium">Install the agent skill</h3>
      <p className="text-sm text-muted-foreground">Run this command in your terminal:</p>
      <code className="block select-all break-all text-sm">{result.agents.skillCommand}</code>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={result.agents.agentDemoVideo} disabled={busy || needsRefresh}
        onChange={e => void request('demo', e.target.checked)} />Ask agents for a demo video</label>
    </>}
  </section>;
}
