import "./gesture-guide.css";
import { Keycap } from "@apparent/ui/keycap";

export function GestureGuide({
  stage,
  shortcut,
  recordKeys,
  platform,
  penRgb,
}: {
  stage: string | null;
  shortcut: string;
  platform: "macos" | "linux";
  recordKeys: readonly string[];
  penRgb: readonly number[];
}) {
  const kind =
    stage === "screen-ink"
      ? "draw"
      : stage === "copied" || stage === "paste"
        ? "paste"
        : (stage === "start" || stage === "retry") && shortcut.trim()
          ? "record"
          : null;
  if (!kind) return null;
  const label =
    kind === "draw"
      ? "Hold Shift and move your pointer to draw"
      : kind === "paste"
        ? `Paste with ${platform === "linux" ? "Control" : "Command"} V`
        : `Record with ${shortcut}`;
  const keys =
    kind === "paste" ? [platform === "linux" ? "Ctrl" : "⌘", "V"] : recordKeys;
  return (
    <figure className="native-gesture" aria-label={label} data-kind={kind}>
      <div className="native-gesture-motion" aria-hidden="true">
        {kind === "draw" ? (
          <>
            <Keycap className="native-gesture-modifier">⇧ Shift</Keycap>
            <svg viewBox="0 0 156 56" className="native-gesture-draw">
              <path
                className="native-gesture-ink"
                stroke={`rgb(${penRgb.join(" ")})`}
                pathLength="1"
                d="M12 44C42 5 112 5 142 44"
              />
              <g className="native-gesture-cursor">
                <path d="M0 0V18L5 13 10 22 13 20 8 11H16Z" />
              </g>
            </svg>
          </>
        ) : (
          <div className="native-gesture-keys">
            {keys.map((key, index) => (
              <Keycap key={index} data-last={index === keys.length - 1}>
                {key}
              </Keycap>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
