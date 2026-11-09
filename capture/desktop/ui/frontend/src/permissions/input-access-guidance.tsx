import { Button } from '@apparent/ui/button';
import { inputAccessView, inputConsent, inputPositionGuidance, inputRestartGuidance, type InputAccess } from './input-access';

export function InputAccessGuidance({ access, onSetup, required = false }: { access: InputAccess | null; onSetup: () => void; required?: boolean }) {
  const view = inputAccessView(access);
  return <article aria-label="Input devices" className="space-y-3" style={{ padding: 16 }}>
    <strong>Input devices{required ? '' : ' · optional'}</strong>
    <p role="status">{view.label}</p>
    <p>{view.detail}</p>
    <p>{inputRestartGuidance}</p>
    <p>{inputPositionGuidance}</p>
    {!(access?.keyboard && access?.pointer) && <><p>{inputConsent}</p><p>Run the copied command yourself in a terminal, then fully log out and back in. Reopening Apparent alone is not enough.</p><Button variant="outline" onClick={onSetup}>Copy setup command</Button></>}
  </article>;
}
