import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@apparent/ui/button";
import { ErrorDialog } from "@apparent/ui/error-dialog";
import type { RecordingBridge, RecordingChange } from "../recording-contract";
import { RecordingControls } from "./recording-controls";
import { RecordingFeed } from "./recording-feed";
import "./recording-section.css";

export function RecordingSection({ bridge }: { bridge: RecordingBridge }) {
  const [feed] = useState(() => new RecordingFeed(bridge));
  const state = useSyncExternalStore(feed.subscribe, feed.snapshot);
  const [pending, setPending] = useState<RecordingChange>();
  const [failure, setFailure] = useState<"save" | "guide">();
  const retry = useRef<() => void>(() => {});
  const focused = useRef<HTMLElement | null>(null);
  const inFlight = useRef(false);

  async function save(change: RecordingChange) {
    if (inFlight.current) return;
    if (!failure) focused.current = document.activeElement as HTMLElement;
    inFlight.current = true;
    retry.current = () => void save(change);
    setPending(change);
    try {
      await bridge.save(change);
      if (feed.connected) setFailure(undefined);
    } catch {
      if (feed.connected) setFailure("save");
    } finally {
      inFlight.current = false;
      if (feed.connected) {
        setPending(undefined);
        requestAnimationFrame(() => {
          if (document.activeElement === document.body)
            focused.current?.focus();
        });
      }
    }
  }

  async function openGuide() {
    if (!failure) focused.current = document.activeElement as HTMLElement;
    retry.current = () => void openGuide();
    try {
      await bridge.openVolumeGuide();
      if (feed.connected) setFailure(undefined);
    } catch {
      if (feed.connected) setFailure("guide");
    }
  }

  return (
    <div className="recording-settings">
      {state === "unavailable" ? (
        <div role="status">
          <p>Recording settings unavailable.</p>
          <Button variant="outline" onClick={feed.refresh}>
            Try again
          </Button>
        </div>
      ) : state ? (
        <RecordingControls
          state={state}
          bridge={bridge}
          pending={pending}
          save={save}
          openGuide={openGuide}
        />
      ) : (
        <p role="status">Loading recording settings…</p>
      )}
      {pending && (
        <span className="sr-only" role="status">
          Saving recording preference…
        </span>
      )}
      <ErrorDialog
        open={!!failure}
        title={
          failure === "guide"
            ? "Couldn’t open the setup guide"
            : "Couldn’t confirm the recording preference"
        }
        description={
          failure === "save"
            ? "Check the current value before trying again."
            : "Try again to reconnect to Settings."
        }
        recoveryLabel="Try again"
        onRecover={() => retry.current()}
        onClose={() => setFailure(undefined)}
        busy={!!pending}
        restoreFocus={() => focused.current?.focus()}
      />
    </div>
  );
}
