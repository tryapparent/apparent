import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Button } from "@apparent/ui/button";
import { X } from "lucide-react";
import mark from "../../../shared/assets/brand/apparent-a.png";
import "./surface.css";

export type Point = [number, number];
export type Paper = { color: [number, number, number]; strokes: Point[][] };
export type Operation =
  | "begin"
  | "move"
  | "end"
  | "cancel"
  | "undo"
  | "clear"
  | "close";
export type Edit = (
  operation: Operation,
  point?: Point,
) => Promise<Paper | null>;
export type Lesson = (state: {
  drawing: boolean;
  hasInk: boolean;
  close: () => void;
}) => ReactNode;

export function Whiteboard({
  initial,
  edit,
  lesson,
  ready,
}: {
  initial: Paper;
  edit: Edit;
  lesson?: Lesson;
  ready: (node: HTMLElement | null) => void;
}) {
  const [paper, setPaper] = useState(initial);
  const [draft, setDraft] = useState<Point[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const pointer = useRef<number | null>(null);
  const pending = useRef(false);
  const failed = useRef(false);

  const fail = useCallback(() => {
    failed.current = true;
    pointer.current = null;
    setError(true);
    setDraft([]);
  }, []);

  const editPaper = useCallback(
    async (operation: Operation) => {
      if (pending.current || failed.current) return;
      pointer.current = null;
      pending.current = true;
      setBusy(true);
      try {
        const revised = await edit(operation);
        if (revised) setPaper(revised);
        setDraft([]);
      } catch {
        fail();
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [edit, fail],
  );

  const close = useCallback(() => {
    void edit("close").catch(() => window.close());
  }, [edit]);

  function draw(
    operation: "begin" | "move",
    event: PointerEvent<SVGSVGElement>,
  ) {
    const rect = event.currentTarget.getBoundingClientRect();
    const point: Point = [
      Math.min(1599, Math.max(0, event.clientX - rect.left)),
      Math.min(1099, Math.max(0, event.clientY - rect.top)),
    ];
    setDraft((current) =>
      operation === "begin"
        ? [point]
        : current.length < 2000
          ? [...current, point]
          : current,
    );
    void edit(operation, point).catch(fail);
  }

  const hasInk = paper.strokes.length > 0;
  const drawing = draft.length > 0;
  const pen = {
    "--board-pen": `rgb(${paper.color.join(", ")})`,
  } as CSSProperties;
  return (
    <main
      ref={ready}
      className="whiteboard"
      style={pen}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "z"
        ) {
          event.preventDefault();
          void editPaper("undo");
        }
      }}
    >
      <header>
        <img src={mark} alt="" />
        <h1>Whiteboard</h1>
        <Button
          variant="outline"
          disabled={busy || error || (!hasInk && !drawing)}
          onClick={() => void editPaper("undo")}
        >
          Undo
        </Button>
        <Button
          variant="outline"
          className="whiteboard-clear"
          disabled={busy || error || (!hasInk && !drawing)}
          onClick={() => void editPaper("clear")}
        >
          Clear
        </Button>
        <Button size="icon" aria-label="Close whiteboard" onClick={close}>
          <X size={18} />
        </Button>
      </header>
      <div className="whiteboard-paper">
        <svg
          aria-label="Whiteboard drawing canvas"
          role="img"
          onPointerDown={(event) => {
            if (
              !event.isTrusted ||
              event.button !== 0 ||
              pointer.current !== null ||
              pending.current ||
              failed.current
            )
              return;
            pointer.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            draw("begin", event);
          }}
          onPointerMove={(event) => {
            if (event.isTrusted && pointer.current === event.pointerId)
              draw("move", event);
          }}
          onPointerUp={(event) => {
            if (event.isTrusted && pointer.current === event.pointerId)
              void editPaper("end");
          }}
          onPointerCancel={(event) => {
            if (event.isTrusted && pointer.current === event.pointerId)
              void editPaper("cancel");
          }}
          onLostPointerCapture={(event) => {
            if (event.isTrusted && pointer.current === event.pointerId)
              void editPaper("cancel");
          }}
        >
          {[...paper.strokes, ...(drawing ? [draft] : [])].map(
            (stroke, index) =>
              stroke.length === 1 ? (
                <circle
                  key={index}
                  cx={stroke[0][0]}
                  cy={stroke[0][1]}
                  r="1.5"
                  fill="var(--board-pen)"
                />
              ) : (
                <polyline
                  key={index}
                  points={stroke.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke="var(--board-pen)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
          )}
        </svg>
        {lesson?.({ drawing, hasInk, close })}
        {error && (
          <p role="alert">
            Whiteboard disconnected. Close this window and reopen Whiteboard
            from the recording controls.
          </p>
        )}
      </div>
    </main>
  );
}
