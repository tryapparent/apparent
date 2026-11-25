import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@apparent/ui/button";
import { ErrorDialog } from "@apparent/ui/error-dialog";
import type { RecordingBridge, RecordingChange } from "../recording-contract";
import { RecordingControls } from "./recording-controls";
import { RecordingFeed } from "./recording-feed";
import "./recording-section.css";

export {
  AgentContextPreference,
  type AgentContextPreferenceProps,
} from "./agent-context-preference";

export function RecordingSection({ bridge }: { bridge: RecordingBridge }) {
  const [feed] = useState(() => new RecordingFeed(bridge));
  const state = useSyncExternalStore(feed.subscribe, feed.snapshot);
  const [pending, setPending] = useState<RecordingChange>();
  const [failure, setFailure] = useState(false);
  const retry = useRef<() => void>(() => {});
  const focused = useRef<HTMLElement | null>(null);
  const inFlight = useRef(false);

  useLayoutEffect(() => {
    if (!pending && !failure && document.activeElement === document.body)
      focused.current?.focus();
  }, [pending, failure]);

  function rememberFocus() {
    const element = document.activeElement;
    if (element instanceof HTMLElement && !element.closest("dialog"))
      focused.current = element;
  }

  async function save(change: RecordingChange) {
    if (inFlight.current) return;
    rememberFocus();
    inFlight.current = true;
    retry.current = () => void save(change);
    setPending(change);
    try {
      await bridge.save(change);
      if (feed.connected) setFailure(false);
    } catch {
      if (feed.connected) setFailure(true);
    } finally {
      inFlight.current = false;
      if (feed.connected) setPending(undefined);
    }
  }

  return (
    <div className="recording-settings">
      {state === "unavailable" ? (
        <div role="status">
          <p>
            Recording settings unavailable.
          </p>
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
        open={failure}
        title="Couldn’t confirm the recording preference"
        description="Check the current value before trying again."
        recoveryLabel="Try again"
        onRecover={() => retry.current()}
        onClose={() => setFailure(false)}
        busy={!!pending}
        restoreFocus={() => focused.current?.focus()}
      />
    </div>
  );
}

export { PushToTalk, type PushToTalkProps } from "./push-to-talk";
