import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@apparent/ui/button";
import {
  permissionNames,
  type PermissionBridge,
  type PermissionError,
  type PermissionIntent,
  type PermissionRow,
  type PermissionState,
} from "./permissions-contract";
import { PermissionsFeed } from "./permissions-feed";
import "./permissions-section.css";

const descriptions = {
  "screen-recording": "Capture what appears on your screen.",
  microphone: "Record your voice.",
  accessibility: "Use shortcuts, ink, and paste across apps.",
  camera: "Show a cabled iPhone.",
  "speech-recognition": "Transcribe your voice with Apple Speech.",
};

const states = {
  granted: "Allowed",
  denied: "Denied",
  "not-determined": "Permission needed",
  unavailable: "Checking access…",
};

const actions = {
  request: "Allow",
  "open-settings": "Open System Settings",
  "copy-input": "Copy command",
};

const errors: Record<PermissionError, string> = {
  unavailable: "Couldn’t confirm permission access. Try Recheck.",
  changed: "Access changed. Check the updated status before trying again.",
  busy: "Another permission check is in progress. Try again in a moment.",
  failed: "Couldn’t complete the action. Try again.",
  "capture-active": "Finish or cancel the capture before reopening Apparent.",
};

export function PermissionsSection({ bridge }: { bridge: PermissionBridge }) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const recheck = useRef<HTMLButtonElement>(null);
  const changingFocus = useRef<Element | null>(null);

  const [feed] = useState(
    () =>
      new PermissionsFeed(bridge, () => {
        const active = document.activeElement;
        if (active?.closest(".record-permission-action"))
          changingFocus.current = active;
      }),
  );
  const snapshot = useSyncExternalStore(feed.subscribe, feed.snapshot);
  const state = snapshot === "unavailable" ? undefined : snapshot;

  useLayoutEffect(() => {
    if (
      changingFocus.current &&
      !changingFocus.current.isConnected &&
      document.activeElement === document.body
    ) {
      recheck.current?.focus();
    }
    changingFocus.current = null;
  }, [state]);

  async function act(intent: PermissionIntent) {
    if (pending) return;
    setPending(true);
    setError("");
    setFeedback("");
    const result = await bridge.act(intent).catch(() => "failed" as const);
    if (!feed.connected()) return;
    setPending(false);
    if (result) setError(errors[result] ?? errors.failed);
    else if (intent.kind === "recheck") setFeedback("Access checked.");
    else if (intent.kind === "repair" && intent.repair === "copy-input") {
      setFeedback(
        "Command copied. Run it in a terminal, then log out and back in.",
      );
    }
  }

  function group(title: string, required: boolean) {
    const rows = state?.rows.filter((row) => row.required === required);
    if (!rows?.length) return null;
    return (
      <section className="record-permission-group" aria-label={title}>
        <h2>{title}</h2>
        <ul>
          {rows.map((row) => (
            <PermissionItem
              key={row.permission}
              row={row}
              platform={state!.platform}
              pending={pending}
              act={act}
            />
          ))}
        </ul>
      </section>
    );
  }

  return (
    <div className="record-permissions">
      {state?.platform === "wayland" && (
        <p>Wayland asks what to share when you start recording.</p>
      )}
      {state?.platform === "x11" && (
        <p>
          On X11, screen capture, clicks, and shortcuts need no separate
          permission.
        </p>
      )}
      <div className="record-permission-controls">
        <Button
          ref={recheck}
          variant="outline"
          aria-disabled={pending}
          onClick={() => void act({ kind: "recheck" })}
        >
          Recheck
        </Button>
        <p role="status">
          {pending || (snapshot === undefined && !error)
            ? "Checking access…"
            : feedback}
        </p>
      </div>
      {(error || snapshot === "unavailable") && (
        <p role="alert">{error || errors.unavailable}</p>
      )}
      {group("Required for recording", true)}
      {group("When you use them", false)}
    </div>
  );
}

function PermissionItem({
  row,
  platform,
  pending,
  act,
}: {
  row: PermissionRow;
  platform: PermissionState["platform"];
  pending: boolean;
  act(intent: PermissionIntent): Promise<void>;
}) {
  const input = platform === "wayland" && row.permission === "accessibility";
  const name = input ? "Input devices" : permissionNames[row.permission];
  const description = input
    ? "Read clicks and Shift ink over other apps."
    : descriptions[row.permission];
  const repair = row.repair;
  const label = row.relaunch
    ? "Reopen Apparent"
    : repair === "none"
      ? null
      : actions[repair];

  return (
    <li className="record-permission-row">
      <div>
        <h3>{name}</h3>
        <p>{description}</p>
        {repair === "copy-input" && (
          <p>Run the command in a terminal, then log out and back in.</p>
        )}
      </div>
      <div className="record-permission-action">
        <span>{row.relaunch ? "Reopen required" : states[row.status]}</span>
        {label && (
          <Button
            variant="outline"
            aria-disabled={pending}
            aria-label={`${label} · ${name}`}
            onClick={() => {
              if (row.relaunch) void act({ kind: "reopen" });
              else if (repair !== "none")
                void act({
                  kind: "repair",
                  permission: row.permission,
                  repair,
                });
            }}
          >
            {label}
          </Button>
        )}
      </div>
    </li>
  );
}
