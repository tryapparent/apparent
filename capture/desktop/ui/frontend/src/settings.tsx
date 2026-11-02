import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentsSettings } from './agents/page';
import { Storage } from './storage';
import { ConnectSettingsCard } from './connect-settings';
import './style.css';
import wordmark from '../../../../../shared/assets/brand/apparent-wordmark.svg';

const surface = new URLSearchParams(location.search).get('surface');
const active = surface === 'connect' ? 'Connect' : surface === 'agents' ? 'Agents' : 'Storage';
document.title = `Apparent Settings — ${active}`;
const panes = ['General', 'Recording', 'Storage', 'Permissions', 'Agents', 'About'] as const;

function Settings() {
  const [error, setError] = useState('');
  const [navigating, setNavigating] = useState(false);
  async function navigate(pane: string) {
    setNavigating(true);
    try {
      await window.apparent?.navigateSettings(pane.toLowerCase());
    } catch { setError('Unable to open that Settings page. Please try again.'); }
    finally { setNavigating(false); }
  }
  return <div className="settings-shell">
    <aside className="settings-sidebar" aria-label="Settings pages">
      <div className="settings-brand"><img src={wordmark} alt="Apparent" /></div>
      <nav>{panes.map(pane => <button key={pane} type="button" disabled={navigating}
        aria-current={pane === active ? 'page' : undefined}
        onClick={() => { if (pane !== active) void navigate(pane); }}>{pane}</button>)}</nav>
    </aside>
    <main className="settings-content">
      <header><h1>{active}</h1>{active !== 'Connect' && <p>{active === 'Agents' ? 'Connect your terminal and coding agents.' : 'Choose where captures live and how long to keep them.'}</p>}</header>
      {error && <p role="alert">{error}</p>}
      {active === 'Connect' ? <ConnectSettingsCard /> : active === 'Agents' ? <AgentsSettings /> : <Storage settings />}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Settings />);
