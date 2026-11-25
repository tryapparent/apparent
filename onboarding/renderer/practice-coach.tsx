import type { CSSProperties, ReactNode, RefObject } from "react";
import { Button } from "@apparent/ui/button";
import { coachCopy } from "./frog/coach-copy";
import { FrogCoach } from "./frog/meet";
import { GestureGuide } from "./gesture-guide";
import "./prompt-motion.css";

type CoachView = {
  platform: "macos" | "linux";
  shortcut: string;
  penRgb: number[];
  frogName?: string;
  coachArrow?: number;
  coachPointsUp?: boolean;
};

export function PracticeCoach({
  view,
  stage,
  wide,
  frog,
  canvasRef,
  recordKeys,
  control,
  error,
  onAction,
  finishSetup,
}: {
  view: CoachView;
  stage: string | null;
  wide: boolean;
  frog: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  recordKeys: readonly string[];
  control: ReactNode;
  error: string;
  onAction(action: string): void;
  finishSetup(): void;
}) {
  const copy = coachCopy(stage, view.platform, view.shortcut);
  const trackpadHint = stage === "screen-ink";
  const complete = stage === "complete";
  const named = Boolean(view.frogName);
  const helper = (
    <aside
      className="native-trackpad-helper"
      aria-label="Trackpad drawing hint"
    >
      <div className="native-trackpad-helper-content">
        <strong>Pressing down on your trackpad?</strong>
        <p>No need. Just hold Shift and glide.</p>
      </div>
    </aside>
  );

  return (
    <>
      <main
        className="native-coach"
        data-paired={trackpadHint && wide}
        data-stage={stage}
        data-arrow={view.coachPointsUp}
        style={
          {
            "--coach-arrow": `${(view.coachArrow ?? 190) - 24}px`,
          } as CSSProperties
        }
      >
        {view.frogName ? (
          <FrogCoach
            name={view.frogName}
            entering={stage === "screen"}
            canvasRef={canvasRef}
          />
        ) : (
          <img src={frog} alt="Frog guide" />
        )}
        <div className="native-coach-content">
          <div key={stage} className="onboarding-prompt-enter">
            {copy.title && <h1>{copy.title}</h1>}
            {copy.text && <p>{copy.text}</p>}
            <GestureGuide
              stage={stage}
              shortcut={view.shortcut}
              recordKeys={recordKeys}
              platform={view.platform}
              penRgb={view.penRgb}
            />
            {control}
            {copy.button && (
              <Button onClick={() => onAction(copy.action!)}>
                {copy.button}
              </Button>
            )}
          </div>
          {trackpadHint && !wide && helper}
          {error && <p role="alert">{error}</p>}
          {named && complete && (
            <Button onClick={finishSetup}>Finish setup</Button>
          )}
          <Button
            hidden={named && complete}
            variant="ghost"
            size="icon"
            className="native-finish-close"
            aria-label={complete ? "Finish setup" : "Close guide"}
            onClick={complete ? finishSetup : () => onAction("later")}
          >
            ×
          </Button>
        </div>
      </main>
      {trackpadHint && wide && helper}
    </>
  );
}
