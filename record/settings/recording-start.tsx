import { useSyncExternalStore } from "react";
import { Button } from "@apparent/ui/button";
import "./recording-start.css";

type Facts = {
  screenPickerSaved?: boolean | null;
  screenPickerSupported?: boolean;
  error?: string;
};

type Bridge = {
  read: () => Promise<Facts>;
  save: (selected: boolean) => Promise<Facts>;
  subscribe: (listener: (facts: Facts) => void) => () => void;
};

type Snapshot = { facts?: Facts; busy: boolean; message: string };

export function recordingStartPreference(bridge: Bridge) {
  let snapshot: Snapshot = { busy: false, message: "" };
  const listeners = new Set<() => void>();
  function update(next: Snapshot) {
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function refresh() {
    if (snapshot.busy) return;
    update({ busy: true, message: "" });
    try {
      const facts = await bridge.read();
      update({
        facts,
        busy: false,
        message: facts.error ? "Couldn’t load this preference." : "",
      });
    } catch {
      update({ busy: false, message: "Couldn’t load this preference." });
    }
  }

  async function change(selected: boolean) {
    const { facts, busy } = snapshot;
    if (busy || facts?.error || !facts?.screenPickerSupported) return;
    update({ facts, busy: true, message: "" });
    try {
      const next = await bridge.save(selected);
      if (next.error || next.screenPickerSaved !== selected)
        throw Error("Save was not confirmed");
      update({
        facts: next,
        busy: false,
        message:
          "Saved. Takes effect the next time you start a screen recording.",
      });
    } catch {
      update({ busy: false, message: "Couldn’t confirm the change." });
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      const unsubscribe = bridge.subscribe((facts) => {
        if (!snapshot.busy)
          update({
            facts,
            busy: false,
            message: facts.error ? "Couldn’t load this preference." : "",
          });
      });
      void refresh();
      return () => {
        unsubscribe();
        listeners.delete(listener);
      };
    },
    refresh,
    change,
  };
}

export function RecordingStartPreference({
  preference,
}: {
  preference: ReturnType<typeof recordingStartPreference>;
}) {
  const { facts, busy, message } = useSyncExternalStore(
    preference.subscribe,
    preference.getSnapshot,
  );
  const displayedPicker = Boolean(
    facts?.screenPickerSupported && facts.screenPickerSaved,
  );

  return (
    <fieldset
      className="agent-preference recording-start-preference"
      aria-busy={busy}
    >
      <legend
        id="recording-start"
        className="settings-preference-label"
        tabIndex={-1}
      >
        When you press Record
      </legend>
      <label>
        <input
          type="radio"
          name="recording-start"
          checked={!displayedPicker}
          disabled={!facts || Boolean(facts.error)}
          aria-disabled={busy}
          onChange={() => void preference.change(false)}
          aria-describedby="recording-start-help"
        />
        <span>Start screen recording right away</span>
      </label>
      <p id="recording-start-help">Your system may still ask what to share.</p>
      <label>
        <input
          type="radio"
          name="recording-start"
          checked={displayedPicker}
          disabled={!facts?.screenPickerSupported}
          aria-disabled={busy}
          onChange={() => void preference.change(true)}
          aria-describedby="recording-picker-help"
        />
        <span>Choose a screen each time</span>
      </label>
      <p id="recording-picker-help">
        {facts && !facts.error && !facts.screenPickerSupported
          ? "This session doesn’t have a system screen picker."
          : "Open the system picker before recording starts."}
      </p>
      <p role="status">{message}</p>
      {!busy && (!facts || facts.error) && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => void preference.refresh()}
        >
          Refresh recording preference
        </Button>
      )}
    </fieldset>
  );
}
