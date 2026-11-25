import { FrogSprite } from "./frog/sprite";
import "./board-lesson.css";
import "./prompt-motion.css";

export function BoardLesson({
  ready,
  hasInk,
  onExampleEnd,
}: {
  ready: boolean;
  hasInk: boolean;
  onExampleEnd: () => void;
}) {
  const prompt = !ready
    ? "Let me show you how to draw."
    : hasInk
      ? "Close when you’re done."
      : "Your turn";
  return (
    <div className="native-board-lesson" data-ready={ready} data-ink={hasInk}>
      <div className="native-board-coach">
        <FrogSprite />
        <p role="status">
          <span key={prompt} className="onboarding-prompt-enter">
            {prompt}
          </span>
        </p>
      </div>
      {!hasInk && (
        <svg aria-hidden="true" viewBox="0 0 720 470">
          <path
            stroke="var(--board-pen)"
            pathLength="1"
            d="M360 167 C307 110 243 137 243 189 C243 246 332 305 360 335"
            onAnimationEnd={onExampleEnd}
          />
        </svg>
      )}
    </div>
  );
}
