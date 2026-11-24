import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { blend, FrogSprite, hop, hopDuration } from "./sprite";
import lily from "./lily.png";

type Flight = {
  fromX: number;
  fromY: number;
  fromWidth: number;
  toX: number;
  toY: number;
};
type State = { name: string; shortcut: string; flight?: Flight };
type FrogBridge = {
  read(): Promise<State>;
  onShortcut(listener: (shortcut: string) => void): () => void;
  start(): void;
  drag(phase: "begin" | "move" | "drop" | "cancel"): void;
  arrived(): void;
};
declare global {
  interface Window {
    desktopFrog: FrogBridge;
  }
}

function FlightView({ path }: { path: Flight }) {
  const motion = useMemo(() => {
    const rise = Math.max(
      0,
      Math.min(
        108,
        Math.abs(path.toX - path.fromX) * 0.21,
        Math.min(path.fromY, path.toY) - 32,
      ),
    );
    return {
      duration: hopDuration,
      frame(elapsed: number) {
        const step = hop(elapsed);
        return {
          ...step,
          x: blend(path.fromX, path.toX, step.flight),
          y: blend(path.fromY, path.toY, step.flight) - rise * step.height,
          width: blend(path.fromWidth, 84, step.flight),
          left: path.toX < path.fromX,
        };
      },
      done: () => window.desktopFrog.arrived(),
    };
  }, [path]);
  return (
    <div className="desktop-frog-flight">
      <FrogSprite motion={motion} />
    </div>
  );
}

let currentShortcut: string | undefined;
function subscribeShortcut(changed: () => void) {
  return window.desktopFrog.onShortcut((shortcut) => {
    currentShortcut = shortcut;
    changed();
  });
}

function DesktopFrog({ name, shortcut }: State) {
  const key = useSyncExternalStore(
    subscribeShortcut,
    () => currentShortcut ?? shortcut,
  );
  const [jumping, setJumping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{
    pointer: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const motion = useMemo(
    () => ({
      duration: hopDuration,
      frame(elapsed: number) {
        const step = hop(elapsed);
        return { ...step, y: -23 * step.height };
      },
      done: () => setJumping(false),
    }),
    [],
  );
  return (
    <main className="desktop-frog" data-dragging={dragging || undefined}>
      <img className="desktop-frog-lily" src={lily} alt="" draggable={false} />
      <button
        className="desktop-frog-pet"
        type="button"
        aria-label={`Make ${name} hop`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = {
            pointer: event.pointerId,
            x: event.screenX,
            y: event.screenY,
            moved: false,
          };
          window.desktopFrog.drag("begin");
        }}
        onPointerMove={(event) => {
          const drag = gesture.current;
          if (!drag || drag.pointer !== event.pointerId) return;
          const dx = event.screenX - drag.x;
          const dy = event.screenY - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) < 5) return;
          drag.moved = true;
          setDragging(true);
          window.desktopFrog.drag("move");
        }}
        onPointerUp={() => {
          const drag = gesture.current;
          gesture.current = null;
          setDragging(false);
          if (drag) window.desktopFrog.drag(drag.moved ? "drop" : "cancel");
        }}
        onLostPointerCapture={() => {
          if (gesture.current) window.desktopFrog.drag("cancel");
          gesture.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => setJumping(true)}
        onClick={(event) => {
          if (event.detail === 0) setJumping(true);
        }}
      >
        <FrogSprite motion={jumping ? motion : undefined} />
      </button>
      <button
        className="desktop-frog-record"
        type="button"
        aria-label="Start apparent"
        onClick={() => window.desktopFrog.start()}
      >
        <span aria-hidden="true" className="desktop-frog-dot" />
        <span aria-hidden="true" className="desktop-frog-tip">
          Start <strong>apparent</strong>
          {key && <kbd>{key}</kbd>}
        </span>
      </button>
    </main>
  );
}

const root = createRoot(document.getElementById("root")!);
void window.desktopFrog
  .read()
  .then((state) =>
    root.render(
      state.flight ? (
        <FlightView path={state.flight} />
      ) : (
        <DesktopFrog {...state} />
      ),
    ),
  );
