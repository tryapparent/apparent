import {
  type ReactNode,
  useCallback,
  useState,
  useSyncExternalStore,
} from "react";
import { Sparkles } from "lucide-react";
import afloat from "./pond-art/afloat.webp";
import bob from "./pond-art/motion/afloat.mp4";
import boat from "./pond-art/boat.webp";
import check from "./pond-art/motion/check.mp4";
import creased from "./pond-art/fold-creased.webp";
import flat from "./pond-art/fold-flat.webp";
import idle from "./pond-art/idle.webp";
import launch from "./pond-art/motion/launch.mp4";
import open from "./pond-art/open.webp";
import paper from "./pond-art/paper.webp";
import pinched from "./pond-art/fold-pinched.webp";

type PondScene =
  | "idle"
  | "checking"
  | "folding"
  | "finishing"
  | "current"
  | "ready";

const folds = [flat, pinched, creased];
const motionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function Folding({ animate }: { animate: boolean }) {
  const [pose, setPose] = useState(0);
  const startFolding = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image || !animate) return;
      let frame = 0;
      let timer = window.setTimeout(changeFold, 550);
      function changeFold() {
        frame = (frame + 1 + Math.floor(Math.random() * 2)) % folds.length;
        setPose(frame);
        timer = window.setTimeout(changeFold, 430 + Math.random() * 510);
      }
      return () => window.clearTimeout(timer);
    },
    [animate],
  );

  return (
    <img ref={startFolding} alt="" src={animate ? folds[pose] : creased} />
  );
}

function TimedPose({ src, advance }: { src: string; advance: () => void }) {
  const hold = useCallback(
    (image: HTMLImageElement | null) => {
      if (!image) return;
      const timer = window.setTimeout(advance, 550);
      return () => window.clearTimeout(timer);
    },
    [advance],
  );
  return <img ref={hold} alt="" src={src} />;
}

function BoatLaunch({ fromBox }: { fromBox: boolean }) {
  const [stage, setStage] = useState(fromBox ? "reveal" : "launch");
  const startLaunch = useCallback(() => setStage("launch"), []);

  if (stage === "reveal") return <TimedPose src={boat} advance={startLaunch} />;
  if (stage === "afloat") {
    return <video src={bob} poster={afloat} autoPlay muted playsInline loop />;
  }
  return (
    <video
      src={launch}
      poster={fromBox ? boat : creased}
      autoPlay
      muted
      playsInline
      onError={() => setStage("afloat")}
      onEnded={() => setStage("afloat")}
    />
  );
}

function FoldReveal() {
  const [revealed, setRevealed] = useState(false);
  const reveal = useCallback(() => setRevealed(true), []);

  return revealed ? (
    <Folding animate />
  ) : (
    <TimedPose src={paper} advance={reveal} />
  );
}

export function Frog({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const [taps, setTaps] = useState(0);
  return (
    <button
      type="button"
      className={
        className ? `settings-frog-button ${className}` : "settings-frog-button"
      }
      aria-label="Boop the frog"
      onClick={() => setTaps((count) => count + 1)}
    >
      {children}
      {taps > 0 && (
        <span
          key={taps}
          className="settings-frog-sparkle"
          data-side={taps % 2 === 1 ? "right" : "left"}
          aria-hidden="true"
        >
          <Sparkles />
        </span>
      )}
    </button>
  );
}

export function UpdatePond({ scene }: { scene: PondScene }) {
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    () => window.matchMedia(motionQuery).matches,
  );
  const [catching, setCatching] = useState(false);
  const visibleScene =
    catching && !reducedMotion && scene !== "idle" ? "checking" : scene;

  const startCatch = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    setCatching(true);
    const timer = window.setTimeout(() => setCatching(false), 2400);
    return () => {
      window.clearTimeout(timer);
      setCatching(false);
    };
  }, []);

  return (
    <Frog className="settings-update-pond">
      {visibleScene === "idle" && <img alt="" src={idle} />}
      {visibleScene === "checking" &&
        (reducedMotion ? (
          <img alt="" src={open} />
        ) : (
          <video
            ref={startCatch}
            src={check}
            poster={idle}
            autoPlay
            muted
            playsInline
            onError={() => setCatching(false)}
            onEnded={() => setCatching(false)}
          />
        ))}
      {visibleScene === "folding" &&
        (reducedMotion ? <Folding animate={false} /> : <FoldReveal />)}
      {visibleScene === "finishing" && <img alt="" src={creased} />}
      {(visibleScene === "current" || visibleScene === "ready") &&
        (reducedMotion ? (
          <img alt="" src={afloat} />
        ) : (
          <BoatLaunch key={visibleScene} fromBox={visibleScene === "current"} />
        ))}
    </Frog>
  );
}
