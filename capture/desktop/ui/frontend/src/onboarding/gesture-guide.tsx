import './gesture-guide.css';
import {Keycap} from '@apparent/ui/keycap';

import { recordKeys } from './shortcut/keys';

/** Presentation only: these illustrations never send keys, draw, or advance setup. */
export function GestureGuide({ kind, shortcut, platform }: {
  kind: 'record' | 'draw' | 'paste'; shortcut: string; platform: 'macos' | 'linux';
}) {
  if (kind === 'record' && !shortcut.trim()) return null;
  const label = kind === 'draw' ? 'Hold Shift and move your pointer to draw' :
    kind === 'paste' ? `Paste with ${platform === 'linux' ? 'Control' : 'Command'} V` : `Record with ${shortcut}`;
  const keys = kind === 'paste' ? [platform === 'linux' ? 'Ctrl' : '⌘', 'V'] :
    recordKeys(shortcut);
  return <figure className="native-gesture" aria-label={label} data-kind={kind}>
    <div className="native-gesture-motion" aria-hidden="true">
      {kind === 'draw' ? <>
        <Keycap className="native-gesture-modifier">⇧ Shift</Keycap>
        <svg viewBox="0 0 156 56" className="native-gesture-draw">
          <path className="native-gesture-ink" pathLength="1" d="M12 44C42 5 112 5 142 44" />
          <g className="native-gesture-cursor"><path d="M0 0V18L5 13 10 22 13 20 8 11H16Z" /></g>
        </svg>
      </> : <div className="native-gesture-keys">{keys.map((key, index) =>
        <Keycap key={index} data-last={index === keys.length - 1}>{key}</Keycap>)}</div>}
    </div>
  </figure>;
}
