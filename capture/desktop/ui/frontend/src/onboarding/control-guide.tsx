import { useState } from 'react';
import { Button } from '@apparent/ui/button';
import icon from '../../../../../../shared/assets/brand/apparent-app-icon.svg';
import './control-guide.css';

/** Illustrated controls, never capture/menu actions. Rust owns real progress. */
export function ControlGuide({ kind, screenOnly = false, directWhiteboard = false, displayOnly = false }: { kind: 'whiteboard' | 'locate'; screenOnly?: boolean; directWhiteboard?: boolean; displayOnly?: boolean }) {
  const [replay, setReplay] = useState(0);
  const label = kind === 'whiteboard' ? screenOnly ? 'Example: click Screen' : directWhiteboard ? 'Example: click Whiteboard' : 'Example: click Screen, then choose Whiteboard' :
    'Example: open the apparent menu, then Open Latest Capture';
  return <figure className="native-control" data-kind={kind} data-screen-only={screenOnly} data-direct-whiteboard={directWhiteboard} data-display-only={displayOnly} aria-label={label}>
    <div key={replay} className="native-control-motion" aria-hidden="true">
      {kind === 'whiteboard' && <svg viewBox="0 0 330 82">
        <rect className="control-pill" x="8" y="15" width="314" height="47" rx="24" />
        <g className="control-screen"><text x="23" y="45">⌃</text><text x="54" y="45">0:00</text><text x="114" y="45">▧ Area</text><rect className="control-highlight" x="193" y="20" width="83" height="36" rx="9"/><text x="201" y="45">▣ Screen</text><text x="300" y="45">×</text></g>
        <g className="control-board"><text x="23" y="45">0:03</text><text x="83" y="45">×</text><rect className="control-highlight" x="119" y="20" width="119" height="36" rx="18"/><text x="132" y="45">✎ Whiteboard</text><text x="259" y="45">□ Finish</text></g>
        <circle className="control-click control-click-one" cx="233" cy="37" r="12"/><circle className="control-click control-click-two" cx="179" cy="37" r="12"/>
        <g className="control-pointer"><path d="M0 0V18L5 13 10 22 13 20 8 11H16Z"/></g>
      </svg>}
      {kind === 'locate' && <svg viewBox={displayOnly ? '0 0 330 126' : '0 0 330 150'}>
        <image href={icon} x="28" y="2" width="23" height="23"/>
        <g className="control-menu" transform="translate(-24 0)"><rect className="control-menu-surface" x="44" y="29" width="300" height={displayOnly ? 93 : 117} rx="7"/>
          <text x="58" y="49">Record Screen</text>{!displayOnly && <text x="58" y="73">Choose What to Record…</text>}
          <g transform={displayOnly ? 'translate(0 -24)' : undefined}><text x="58" y="97">Microphone for next screen capture</text>
          <path className="control-menu-separator" d="M53 105H335"/><rect className="control-menu-target" x="50" y="109" width="288" height="30" rx="4"/>
          <text x="58" y="130" className="control-menu-target-label">Open Latest Capture</text></g>
          <path className="control-menu-arrow" d={displayOnly ? 'M46 13C24 20 24 43 26 67Q28 99 42 101m-7-6 7 6-8 5' : 'M46 13C24 20 24 43 26 67Q28 123 42 125m-7-6 7 6-8 5'}/>
        </g>
        <circle className="control-click control-click-one" cx="40" cy="13" r="12"/><circle className="control-click control-click-two" cx="166" cy={displayOnly ? 100 : 124} r="12"/>
        <g className="control-pointer"><path d="M0 0V18L5 13 10 22 13 20 8 11H16Z"/></g>
      </svg>}
    </div>
    <Button variant="ghost" size="icon" className="native-control-replay" aria-label={`Replay ${kind === 'whiteboard' ? directWhiteboard ? 'Whiteboard' : screenOnly ? 'Screen' : 'Screen and Whiteboard' : 'location'} guide`} onClick={() => setReplay(value => value + 1)}>↻</Button>
  </figure>;
}
