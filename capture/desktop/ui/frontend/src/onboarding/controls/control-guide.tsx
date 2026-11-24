import icon from '../../../../../../../shared/assets/brand/apparent-app-icon.svg';
import './control-guide.css';
import {PillGuide} from './pill-guide';

export function ControlGuide({ kind, screenOnly = false, onTarget }: { kind: 'whiteboard' | 'finish' | 'locate'; screenOnly?: boolean; onTarget?: () => void; }) {
  if(kind!=='locate')return <PillGuide screenOnly={screenOnly} finish={kind==='finish'} onTarget={onTarget}/>;
  const label = 'Example: open the apparent menu, then Open Latest Capture';
  return <figure className="native-control" data-kind={kind} data-screen-only={screenOnly} aria-label={label}>
    <div className="native-control-motion" aria-hidden="true">
      {kind === 'locate' && <svg viewBox="0 0 330 150">
        <image href={icon} x="28" y="2" width="23" height="23"/>
        <g className="control-menu" transform="translate(-24 0)"><rect className="control-menu-surface" x="44" y="29" width="300" height="117" rx="7"/>
          <text x="58" y="49">Record Screen</text><text x="58" y="73">Choose What to Record…</text><text x="58" y="97">Microphone for next screen capture</text>
          <path className="control-menu-separator" d="M53 105H335"/><rect className="control-menu-target" x="50" y="109" width="288" height="30" rx="4"/>
          <text x="58" y="130" className="control-menu-target-label">Open Latest Capture</text>
          <path className="control-menu-arrow" d="M46 13C24 20 24 43 26 67Q28 123 42 125m-7-6 7 6-8 5"/>
        </g>
        <circle className="control-click control-click-one" cx="40" cy="13" r="12"/><circle className="control-click control-click-two" cx="166" cy="124" r="12"/>
        <g className="control-pointer"><path d="M0 0V18L5 13 10 22 13 20 8 11H16Z"/></g>
      </svg>}
    </div>
  </figure>;
}
