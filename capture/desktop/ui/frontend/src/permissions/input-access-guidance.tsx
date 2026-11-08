import { Button } from '@apparent/ui/button';
import { inputAccessView, inputConsent, type InputAccess } from './input-access';

export function InputAccessGuidance({ access, onSetup, required = false }: { access: InputAccess | null; onSetup: () => void; required?: boolean }) {
  const view = inputAccessView(access);
  return <article aria-label="Input devices" className="space-y-3" style={{ padding: 16 }}>
    <strong>Input devices{required ? '' : ' · optional'}</strong>
    <p role="status">{view.label}</p>
    <p>{view.detail}</p>
    {!(access?.keyboard && access?.pointer) && <><p>{inputConsent}</p><Button variant="outline" onClick={onSetup}>Read setup instructions</Button></>}
  </article>;
}
