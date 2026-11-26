import { useEffect, useRef, useState } from 'react';
import { Button } from '@apparent/ui/button';
import { X } from 'lucide-react';
import './notes.css';

type Note = { pin: number; t: number; x: number; y: number; text: string };
type Snapshot = { mode: 'badge' | 'editor' | 'list'; current: number | null;
  notes: Note[]; drafts: Note[]; error: string | null };
type Command = { action: 'save' | 'draft'; pin: number; text: string } | { action: 'dismiss' };
declare global {
  interface Window { captureNotes?: {
    onSnapshot: (callback: (state: Snapshot) => void) => () => void;
    command: (command: Command) => Promise<void>;
  } }
}
export function CaptureNotes() {
  const [state, setState] = useState<Snapshot>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const current = useRef<number | null>(null);
  useEffect(() => window.captureNotes?.onSnapshot(next => {
    setState(next); setError(next.error ?? undefined);
    if (next.error || next.mode !== 'editor') setBusy(false);
    if (next.current !== current.current || next.mode !== 'editor') {
      current.current = next.current;
      setText(next.drafts.find(n => n.pin === next.current)?.text ?? '');
    }
  }), []);
  async function command(message: Command) {
    if (!window.captureNotes) { setError('Notes are not connected to the recording.'); return; }
    try { await window.captureNotes.command(message); }
    catch { setBusy(false); setError('Could not save this note. Your text is kept; try again.'); }
  }
  function save() {
    if (!state?.current || busy) return;
    setBusy(true); void command({ action: 'save', pin: state.current, text });
  }
  const dismiss = () => { void command({ action: 'dismiss' }); };
  if (!state) return <div className="capture-notes" role="status">Connecting notes…</div>;
  return <main className="capture-notes" onClick={e => {
    if (e.target === e.currentTarget) void dismiss();
  }} onKeyDown={e => {
    if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); void dismiss(); }
  }}>
    {state.mode === 'list' ? <section className="note-list" role="dialog" aria-label="Notes">
      <header><strong>Notes</strong><Button variant="ghost" size="icon" aria-label="Close notes" onClick={dismiss}><X aria-hidden="true" /></Button></header>
      {state.notes.length === 0 ? <p>No notes yet.</p> :
        <ul className="note-rows" aria-label="Saved notes" tabIndex={0}>
          {state.notes.map(n => <li key={n.pin}>
            <span className="note-number">{n.pin}</span><span className="note-text">{n.text}</span>
          </li>)}
        </ul>}
      {error && <p role="alert">{error}</p>}
    </section> : state.mode === 'editor' ? <form className="note-popup" aria-label={`Note at pin ${state.current}`} onSubmit={e => { e.preventDefault(); save(); }}>
      <textarea key={state.current} autoFocus aria-label="Note text" placeholder="What should change?" value={text} rows={3} maxLength={8192}
        onChange={e => { const value = e.target.value; setText(value); if (state.current) void command({ action: 'draft', pin: state.current, text: value }); }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(); }
        }} />
      {error && <p role="alert">{error}</p>}
      <footer><Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Attach'}<span aria-hidden="true">↵</span></Button></footer>
    </form> : null}
  </main>;
}
