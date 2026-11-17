import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { About } from './settings/about/about';
import { Agents } from './settings/agents/agents';
import { Labs } from './settings/labs/labs';
import { General } from './general';
import { Storage } from './storage';
import './style.css';
import wordmark from '../../../../../shared/assets/brand/apparent-wordmark.svg';
import { Button } from '@apparent/ui/button';

const panes = ['General', 'Recording', 'Storage', 'Permissions', 'Agents', 'Labs', 'About'] as const;
// Match the native sidebar symbols without adding a renderer dependency.
const icons = [
  <><path d="M12 8v8M8 12h8" /><circle cx="12" cy="12" r="9" /></>,
  <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /></>,
  <><path d="m5 4-3 9v7h20v-7l-3-9ZM2 13h20M6 17h.01M10 17h.01" /></>,
  <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6ZM8 12l3 3 5-6" /></>,
  <><path d="m4 5 6 6-6 6M13 19h7" /></>,
  <><path d="M9 3h6M10 3v6l-6 10a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2L14 9V3M8 14h8" /></>,
  <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
];

declare global {
  interface Window { apparentSettingsMounted?: () => Promise<void>; }
  interface Window { apparentSettingsRoute?: (callback: (pane: string) => void) => () => void; }
}

function Settings() {
  const [current, setCurrent] = useState(location.hash === '#about' ? 'About' : location.hash === '#agents' ? 'Agents' : location.hash === '#labs' ? 'Labs' : location.hash === '#general' ? 'General' : 'Storage');
  useLayoutEffect(() => window.apparentSettingsRoute?.(pane => {
    const selected = panes.find(value => value.toLowerCase() === pane);
    if (selected) { setCurrent(selected); setError(''); }
  }), []);
  useLayoutEffect(() => { document.title = `Apparent Settings — ${current}`; }, [current]);
  useLayoutEffect(() => {
    // React's DOM is committed here. The preload owns the first-frame wait;
    // a hidden page's animation scheduling must not hold up this acknowledgement.
    void window.apparentSettingsMounted?.().catch(() => {});
  }, []);
  const [error, setError] = useState('');
  const [navigating, setNavigating] = useState(false);
  async function navigate(pane: string) {
    setNavigating(true);
    try {
      await window.apparent?.navigateSettings(pane.toLowerCase());
    } catch { setError('Unable to open that Settings page. Please try again.'); }
    finally { setNavigating(false); }
  }
  return <div className={`settings-shell${current==='General'?' settings-general-shell':''}`}>
    <aside className="settings-sidebar" aria-label="Settings pages">
      <div className="settings-brand"><img src={wordmark} alt="Apparent" /></div>
      <nav>{panes.map((pane, index) => <Button variant="ghost" key={pane} type="button" disabled={navigating}
        aria-current={pane === current ? 'page' : undefined}
        onClick={() => { if (pane !== current) void navigate(pane); }}>
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icons[index]}</svg>{pane}</Button>)}</nav>
    </aside>
    <main className="settings-content">
      <header className="settings-page-heading"><h1>{current}</h1><div id="settings-account" /></header>
      {error && <p role="alert">{error}</p>}
      {current === 'About' ? <About /> : current === 'Agents' ? <Agents /> : current === 'Labs' ? <Labs /> : current === 'General' ? <General /> : <Storage settings />}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Settings />);
