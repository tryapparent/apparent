import icon from '../../../../../../shared/assets/brand/apparent-app-icon.svg';
import './control-guide.css';

/** Illustrated controls, never capture/menu actions. Rust owns real progress. */
export function ControlGuide({ kind, screenOnly = false, directWhiteboard = false, settings = false }: { kind: 'whiteboard' | 'finish' | 'locate'; screenOnly?: boolean; directWhiteboard?: boolean; settings?:boolean }) {
  const label = kind === 'whiteboard' ? screenOnly ? 'Example: click Screen' : directWhiteboard ? 'Example: click Whiteboard' : 'Example: click Screen, then choose Whiteboard' :
    kind === 'finish' ? 'Example: Finish stops recording, then the handoff is copied' : settings?'Example: open the apparent menu, then Settings':'Example: open the apparent menu, then Open Latest Capture';
  return <figure className="native-control" data-kind={kind} data-screen-only={screenOnly} data-direct-whiteboard={directWhiteboard} aria-label={label}>
    <div className="native-control-motion" aria-hidden="true">
      {kind === 'whiteboard' && <svg viewBox="0 0 330 82">
        <rect className="control-pill" x="8" y="15" width="314" height="47" rx="24" />
        <g className="control-screen"><text x="23" y="45">⌃</text><text x="54" y="45">0:00</text><text x="114" y="45">▧ Area</text><rect className="control-highlight" x="193" y="20" width="83" height="36" rx="9"/><text x="201" y="45">▣ Screen</text><text x="300" y="45">×</text></g>
        <g className="control-board"><text x="23" y="45">0:03</text><path className="control-waveform" d="M77 35v10m4-13v16m4-10v6m4-14v20m4-16v12m4-9v6m4-12v18m4-13v8"/><text x="115" y="45">×</text><rect className="control-highlight" x="139" y="20" width="117" height="36" rx="18"/><text x="149" y="45">✎ Whiteboard</text><rect className="control-finish-button" x="263" y="20" width="53" height="36" rx="18"/><text className="control-action-label" x="269" y="44" fontSize="12">□ Finish</text></g>
        <circle className="control-click control-click-one" cx="233" cy="37" r="12"/><circle className="control-click control-click-two" cx="179" cy="37" r="12"/>
        <g className="control-pointer"><path d="M0 0V18L5 13 10 22 13 20 8 11H16Z"/></g>
      </svg>}
      {kind === 'finish' && <svg viewBox="0 0 330 82">
        <rect className="control-recording-pill" x="8" y="19" width="314" height="42" rx="21"/>
        <g className="control-before-finish"><circle cx="24" cy="40" r="3" className="control-record-dot"/><text x="34" y="44">0:28</text><text x="83" y="44">Cancel</text><text x="144" y="44">▣ Screen</text><rect className="control-finish-button" x="247" y="25" width="65" height="30" rx="7"/><text x="258" y="44">Finish ■</text></g>
        <g className="control-copied"><circle cx="135" cy="40" r="9"/><path d="M130 40l4 4 7-9"/><text x="152" y="45">Copied</text></g>
        <circle className="control-click control-click-one" cx="276" cy="40" r="12"/>
        <g className="control-pointer"><path d="M0 0V18L5 13 10 22 13 20 8 11H16Z"/></g>
      </svg>}
      {kind === 'locate' && <svg viewBox="0 0 330 150">
        <image href={icon} x="28" y="2" width="23" height="23"/>
        <g className="control-menu" transform="translate(-24 0)"><rect className="control-menu-surface" x="44" y="29" width="300" height="117" rx="7"/>
          <text x="58" y="49">Record Screen</text><text x="58" y="73">Choose What to Record…</text><text x="58" y="97">Microphone for next screen capture</text>
          <path className="control-menu-separator" d="M53 105H335"/><rect className="control-menu-target" x="50" y="109" width="288" height="30" rx="4"/>
          <text x="58" y="130" className="control-menu-target-label">{settings?'Settings…':'Open Latest Capture'}</text>
          <path className="control-menu-arrow" d="M46 13C24 20 24 43 26 67Q28 123 42 125m-7-6 7 6-8 5"/>
        </g>
        <circle className="control-click control-click-one" cx="40" cy="13" r="12"/><circle className="control-click control-click-two" cx="166" cy="124" r="12"/>
        <g className="control-pointer"><path d="M0 0V18L5 13 10 22 13 20 8 11H16Z"/></g>
      </svg>}
    </div>
  </figure>;
}
