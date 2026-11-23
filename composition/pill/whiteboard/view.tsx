import { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Whiteboard,
  type Edit,
  type Lesson,
  type Paper,
} from "../../../record/pill/whiteboard/renderer";
import {
  BoardLesson,
  boardLessonHoldMs,
} from "../../../onboarding/renderer/board-lesson";
import "@apparent/ui/tokens.css";

declare global {
  interface Window {
    apparentWhiteboard: {
      initial(): Promise<{ paper: Paper; practice: boolean }>;
      edit: Edit;
      ready(): void;
    };
  }
}

function PracticeLesson({ drawing, hasInk, close }: Parameters<Lesson>[0]) {
  const [demonstrated, setDemonstrated] = useState(false);
  const hold = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !hasInk || drawing) return;
      const timer = window.setTimeout(close, boardLessonHoldMs);
      return () => window.clearTimeout(timer);
    },
    [close, drawing, hasInk],
  );
  return (
    <div ref={hold}>
      <BoardLesson
        ready={demonstrated || drawing || hasInk}
        onExampleEnd={() => setDemonstrated(true)}
      />
    </div>
  );
}

function ready(node: HTMLElement | null) {
  if (!node) return;
  node.focus({ preventScroll: true });
  window.apparentWhiteboard.ready();
}

function Surface({ paper, practice }: { paper: Paper; practice: boolean }) {
  return (
    <Whiteboard
      ready={ready}
      initial={paper}
      edit={window.apparentWhiteboard.edit}
      lesson={practice ? (props) => <PracticeLesson {...props} /> : undefined}
    />
  );
}

const root = createRoot(document.getElementById("root")!);
void window.apparentWhiteboard.initial().then(
  (initial) => root.render(<Surface {...initial} />),
  () => {
    root.render(
      <p role="alert">
        Whiteboard unavailable. Close this window and reopen Whiteboard from the
        recording controls.
      </p>,
    );
    window.apparentWhiteboard.ready();
  },
);
