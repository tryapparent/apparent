import "./board-lesson.css";

export function BoardLesson({
  hasStroke,
  drawing,
}: {
  hasStroke: boolean;
  drawing: boolean;
}) {
  return (
    <div className="native-board-lesson" data-has-stroke={hasStroke}>
      <p role="status">
        {hasStroke ? "Draw once more, or close the whiteboard." : "Your turn."}
      </p>
      {!hasStroke && !drawing && (
        <svg aria-hidden="true" viewBox="0 0 300 160">
          <path
            stroke="var(--board-pen)"
            pathLength="1"
            d="M34 105 C52 32 124 20 149 58 S102 142 82 101 S174 23 214 67 S240 144 184 116 Q139 93 252 44"
          />
        </svg>
      )}
    </div>
  );
}
