import {useEffect, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {preferenceEnabled, skillCommand, type PreferenceFacts} from './policy';

declare global {
  interface Window {
    apparentAgents: {
      read(): Promise<PreferenceFacts>;
      save(enabled: boolean): Promise<PreferenceFacts>;
      copySkill(): Promise<void>;
      subscribe(callback: (facts: PreferenceFacts) => void): () => void;
    };
  }
}

export function Agents() {
  const [facts, setFacts] = useState<PreferenceFacts>();
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<'read' | 'save'>('read');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const live = useRef(true);
  const pending = useRef(false);
  const revision = useRef(0);
  async function request(enabled?: boolean) {
    if (pending.current) return;
    pending.current = true;
    setOperation(enabled === undefined ? 'read' : 'save');
    setBusy(true); setError('');
    const version = ++revision.current;
    try {
      const result = await (enabled === undefined ? window.apparentAgents.read() : window.apparentAgents.save(enabled));
      if (!live.current || version !== revision.current) return;
      setFacts(result);
      if (result.error) setError(result.error === 'config_read_failed'
        ? 'Unable to read this preference. Refresh to try again.'
        : 'Unable to save this preference. Refresh, then try again.');
    } catch {
      if (live.current) {
        setFacts(undefined);
        setError('The app did not confirm this preference. Refresh to check the saved value.');
      }
    } finally {
      pending.current = false;
      if (live.current) setBusy(false);
    }
  }
  useEffect(() => {
    live.current = true;
    const unsubscribe = window.apparentAgents.subscribe(value => {
      if (live.current && !pending.current) {
        ++revision.current;
        setFacts(value);
        setError(value.error ? 'Unable to read this preference. Refresh to try again.' : '');
      }
    });
    void request();
    return () => { live.current = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copy() {
    setCopyError(false); setCopied(false);
    try { await window.apparentAgents.copySkill(); if (live.current) setCopied(true); }
    catch { if (live.current) setCopyError(true); }
  }
  const enabled = facts && preferenceEnabled(facts);
  return <section className="settings-agents" aria-label="Agent preferences">
    <div className="settings-agent-preference">
      <div>
        <h2 id="agent-video-label">Ask for an Apparent video on complex changes</h2>
        <p id="agent-video-help" className="settings-metadata">Adds a video request to copied and pasted captures when the agent can record the result. On by default.</p>
      </div>
      <Button type="button" role="switch" aria-checked={enabled ?? false}
        aria-labelledby="agent-video-label" aria-describedby="agent-video-help"
        disabled={busy || enabled === undefined} variant={enabled ? 'default' : 'secondary'}
        onClick={() => void request(!enabled)}>{enabled === undefined ? '—' : enabled ? 'On' : 'Off'}</Button>
    </div>
    <p role="status" className="settings-metadata">{busy ? operation === 'save' ? 'Saving preference…' : 'Reading saved preference…' : !facts && !error ? 'Loading preference…' : ''}</p>
    {error && <div><p role="alert">{error}</p><Button variant="secondary" disabled={busy} onClick={() => void request()}>Refresh preference</Button></div>}
    <section className="settings-agent-skill" aria-labelledby="agent-skill-label">
      <h2 id="agent-skill-label">Agent skill</h2>
      <p className="settings-metadata">Run this in a terminal to teach Claude Code, OpenCode, Codex and other agents to read your captures and use Apparent.</p>
      <code className="settings-agent-command">{skillCommand}</code>
      <div className="settings-actions">
        <Button variant="secondary" onClick={() => void copy()}>Copy command</Button>
        <span role="status" className="settings-metadata">{copied ? 'Copied' : ''}</span>
      </div>
      {copyError && <p role="alert">Unable to copy. Try Copy command again, or select and copy the command above.</p>}
    </section>
  </section>;
}
