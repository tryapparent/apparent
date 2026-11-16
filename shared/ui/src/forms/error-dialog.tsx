import {useEffect, useId, useRef, type ReactNode} from 'react';
import {Button} from '../button';
import './error-dialog.css';

/** Operational failure. The caller owns facts, recovery and dismissal state. */
export function ErrorDialog({open, title, description, recoveryLabel, onRecover, onClose, artwork, busy = false, restoreFocus}: {
  open: boolean; title: string; description: string; recoveryLabel: string;
  onRecover: () => void; onClose: () => void; artwork?: ReactNode; busy?: boolean; restoreFocus?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recovery = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current!;
    if (open && !element.open) { element.showModal(); recovery.current?.focus(); }
    else if (!open && element.open) { element.close(); restoreFocus?.(); }
  }, [open, restoreFocus]);
  return <dialog ref={dialog} className="apparent-error-dialog" role="alertdialog" aria-modal="true"
    aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    {artwork && <div className="error-artwork">{artwork}</div>}
    <h2 id={`${id}-title`}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>{title}</h2>
    <p id={`${id}-description`}>{description}</p>
    <div className="error-actions">
      <Button ref={recovery} className="error-recover" disabled={busy} aria-busy={busy} onClick={onRecover}>{recoveryLabel}</Button>
      <Button className="error-close" variant="outline" disabled={busy} onClick={onClose}>Close</Button>
    </div>
  </dialog>;
}
