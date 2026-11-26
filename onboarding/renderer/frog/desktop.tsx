import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { blend, FrogSprite, hop, hopDuration } from "./sprite";
import lily from "./lily.png";
import {
  accessoryNames,
  FrogAccessory,
  type Accessory,
} from "./wardrobe/accessory";

type Flight = {
  fromX: number;
  fromY: number;
  fromWidth: number;
  toX: number;
  toY: number;
};
type State = {
  name: string;
  shortcut: string;
  flight?: Flight;
  equipped?: Accessory[];
};
type FrogBridge = {
  read(): Promise<State>;
  onShortcut(listener: (shortcut: string) => void): () => void;
  onWardrobe(
    listener: (items: Accessory[], achievement?: [number, Accessory]) => void,
  ): () => void;
  start(): void;
  menu(): void;
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

type WardrobeView = {
  wardrobe: Accessory[];
  reward?: { total: number; item: Accessory; revealed: boolean };
};

function wardrobeController(wardrobe: Accessory[]) {
  let view: WardrobeView = { wardrobe };
  return {
    snapshot: () => view,
    subscribe(notify: () => void) {
      let reveal: ReturnType<typeof setTimeout> | undefined;
      let dismiss: ReturnType<typeof setTimeout> | undefined;
      const clear = () => {
        clearTimeout(reveal);
        clearTimeout(dismiss);
      };
      const publish = (next: WardrobeView) => {
        view = next;
        notify();
      };
      const unsubscribe = window.desktopFrog.onWardrobe(
        (items, achievement) => {
          if (!achievement) {
            const reward = view.reward;
            if (reward && !items.includes(reward.item)) {
              clear();
              publish({ wardrobe: items });
            } else {
              publish({ wardrobe: items, reward });
            }
            return;
          }
          clear();
          const [total, item] = achievement;
          const revealed = matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          publish({ wardrobe: items, reward: { total, item, revealed } });
          if (!revealed) {
            reveal = setTimeout(() => {
              publish({ ...view, reward: { total, item, revealed: true } });
            }, 420);
          }
          dismiss = setTimeout(
            () => publish({ wardrobe: view.wardrobe }),
            3100,
          );
        },
      );
      return () => {
        clear();
        unsubscribe();
      };
    },
  };
}

function DesktopFrog({ name, shortcut, equipped }: State) {
  const [controller] = useState(() => wardrobeController(equipped ?? []));
  const { wardrobe, reward } = useSyncExternalStore(
    controller.subscribe,
    controller.snapshot,
  );
  const dressed = useMemo(
    () =>
      reward && !reward.revealed
        ? wardrobe.filter((item) => item !== reward.item)
        : wardrobe,
    [wardrobe, reward],
  );
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
    <main
      className="desktop-frog"
      data-dragging={dragging || undefined}
      data-celebrating={!!reward || undefined}
    >
      {dressed.includes("lily-pad") ? (
        <span className="desktop-frog-lily desktop-frog-alternate-pad">
          <FrogAccessory item="lily-pad" />
        </span>
      ) : (
        <img
          className="desktop-frog-lily"
          src={lily}
          alt=""
          draggable={false}
        />
      )}
      <button
        className="desktop-frog-pet"
        type="button"
        aria-label={`Make ${name} hop`}
        aria-haspopup="menu"
        onContextMenu={(event) => {
          event.preventDefault();
          window.desktopFrog.menu();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            window.desktopFrog.menu();
          }
        }}
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
        <FrogSprite motion={jumping ? motion : undefined} wardrobe={dressed} />
      </button>
      {reward && (
        <div
          className="desktop-frog-streamers"
          aria-hidden="true"
          key={reward.total}
        >
          {Array.from({ length: 8 }, (_, index) => (
            <i key={index} />
          ))}
        </div>
      )}
      <div className="desktop-frog-achievement" role="status">
        {reward?.revealed && (
          <>
            <strong>{reward.total} recordings saved</strong>
            <span>{accessoryNames[reward.item]} equipped</span>
          </>
        )}
      </div>
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
