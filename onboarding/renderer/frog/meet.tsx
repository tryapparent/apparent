import { useMemo, useState, type RefObject } from "react";
import { Button } from "@apparent/ui/button";
import { blend, FrogSprite, hop, hopDuration } from "./sprite";
import lily from "./lily.png";
import "./meet.css";

export function MeetFrog({
  submit,
  saveError,
}: {
  submit(name: string): Promise<boolean>;
  saveError: boolean;
}) {
  const [name, setName] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [failure, setFailure] = useState(false);
  const motion = useMemo(
    () => ({
      duration: hopDuration * 2,
      frame(elapsed: number) {
        const first = elapsed < hopDuration;
        const arc = hop(first ? elapsed : elapsed - hopDuration);
        return {
          ...arc,
          x: blend(first ? -150 : -62, first ? -62 : 0, arc.flight),
          y: -(first ? 40 : 32) * arc.height,
        };
      },
    }),
    [],
  );
  const ready = name.trim().length > 0;
  return (
    <form
      className="meet-frog"
      onSubmit={async (event) => {
        event.preventDefault();
        if (waiting || !ready) return;
        setWaiting(true);
        setFailure(false);
        try {
          if (!(await submit(name))) setFailure(true);
        } catch {
          setFailure(true);
        } finally {
          setWaiting(false);
        }
      }}
    >
      <div className="meet-frog-art">
        <img src={lily} alt="" />
        <FrogSprite motion={motion} />
      </div>
      <div className="meet-frog-name">
        <h1 aria-label="Meet your frog">Meet</h1>
        <label className="sr-only" htmlFor="meet-frog-input">
          Name your frog
        </label>
        <span className="meet-frog-field">
          <span aria-hidden="true">{name || "\u00a0"}</span>
          <input
            id="meet-frog-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={24}
            autoComplete="off"
            autoFocus
            required
          />
        </span>
      </div>
      <div className="meet-frog-action">
        {ready && (
          <Button type="submit" disabled={waiting}>
            Continue
          </Button>
        )}
      </div>
      {(saveError || failure) && (
        <p role="alert">Couldn’t save your frog’s name. Try again.</p>
      )}
    </form>
  );
}

const perchHop = {
  duration: hopDuration,
  frame(elapsed: number) {
    const arc = hop(elapsed);
    return {
      ...arc,
      x: blend(59, 0, arc.flight),
      y: -16 * arc.height,
      left: true,
    };
  },
};

export function FrogCoach({
  name,
  entering,
  canvasRef,
}: {
  name: string;
  entering: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  return (
    <div className="frog-coach-actor">
      <FrogSprite
        motion={entering ? perchHop : undefined}
        canvasRef={canvasRef}
        left
      />
      <span>{name}</span>
    </div>
  );
}
