import "./board-lesson.css";

export function BoardLesson({
  ready,
  hasInk,
  onExampleEnd,
}: {
  ready: boolean;
  hasInk: boolean;
  onExampleEnd: () => void;
}) {
  const turnPrompt = hasInk ? "Close when you’re done." : "Your turn";
  return (
    <div className="native-board-lesson" data-ready={ready} data-ink={hasInk}>
      <p role="status">{ready ? turnPrompt : "Let me show you how to draw."}</p>
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
