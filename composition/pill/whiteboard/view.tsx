import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Whiteboard,
  type Edit,
  type Lesson,
  type Paper,
} from "../../../record/pill/whiteboard/renderer";
import { BoardLesson } from "../../../onboarding/renderer/board-lesson";
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

function PracticeLesson({ drawing, hasInk }: Parameters<Lesson>[0]) {
  const [demonstrated, setDemonstrated] = useState(false);
  return (
    <BoardLesson
      ready={demonstrated || drawing || hasInk}
      hasInk={hasInk}
      onExampleEnd={() => setDemonstrated(true)}
    />
  );
}

function ready(node: HTMLElement | null) {
  if (!node) return;
  const keepCloseFocus = document.activeElement?.id === "close-opening";
  document.getElementById("opening")?.remove();
  const focus = keepCloseFocus
    ? node.querySelector<HTMLElement>('button[aria-label="Close whiteboard"]')
    : node;
  (focus ?? node).focus({ preventScroll: true });
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
    const status = document.getElementById("opening-status")!;
    status.setAttribute("role", "alert");
    status.textContent = "Whiteboard unavailable. Close and reopen Whiteboard.";
  },
);
