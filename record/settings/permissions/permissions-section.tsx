import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@apparent/ui/button";
import { Switch } from "@apparent/ui/switch";
import {
  Accessibility,
  Camera,
  CircleAlert,
  CircleCheck,
  Mic,
  Monitor,
  Mouse,
  Speech,
} from "lucide-react";
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

const icons = {
  "screen-recording": Monitor,
  microphone: Mic,
  accessibility: Accessibility,
  camera: Camera,
  "speech-recognition": Speech,
};

const actions = {
  request: "Allow",
  "open-settings": "Open System Settings",
  "copy-input": "Copy command",
};

const errors: Record<PermissionError, string> = {
  unavailable: "Couldn’t confirm permission access. Check again.",
  changed: "Access changed. Check the updated status before trying again.",
  busy: "Another permission action is in progress. Try again in a moment.",
  failed: "Couldn’t complete the action. Try again.",
  "capture-active": "Finish or cancel the capture before reopening Apparent.",
};

type Feedback = {
  row: PermissionRow["permission"];
  message: string;
  error: boolean;
};

export function PermissionsSection({ bridge }: { bridge: PermissionBridge }) {
  const [pending, setPending] = useState<PermissionIntent>();
  const [feedback, setFeedback] = useState<Feedback>();
  const [saveError, setSaveError] = useState(false);
  const accessHeading = useRef<HTMLHeadingElement>(null);
  const changingFocus = useRef<
    { element: Element; fallback?: HTMLElement } | undefined
  >(undefined);

  const [feed] = useState(
    () =>
      new PermissionsFeed(bridge, () => {
        const element = document.activeElement;
        if (element?.closest(".record-permissions button")) {
          const fallback = element
            .closest(".record-permission-row")
            ?.querySelector("h3");
          changingFocus.current = { element, fallback: fallback ?? undefined };
        }
      }),
  );
  const snapshot = useSyncExternalStore(feed.subscribe, feed.snapshot);
  const state = snapshot?.facts;

  useLayoutEffect(() => {
    const previous = changingFocus.current;
    if (
      previous &&
      !previous.element.isConnected &&
      document.activeElement === document.body
    )
      (previous.fallback?.isConnected
        ? previous.fallback
        : accessHeading.current
      )?.focus();
    changingFocus.current = undefined;
  }, [snapshot]);

  async function act(
    intent: PermissionIntent,
    row?: PermissionRow["permission"],
  ) {
    if (pending) return;
    setPending(intent);
    setFeedback(undefined);
    if (intent.kind === "screen-selection") setSaveError(false);

    const result = await bridge.act(intent).catch(() => "failed" as const);
    const saved =
      !result && intent.kind === "screen-selection"
        ? await bridge.read().catch(() => undefined)
        : undefined;
    if (!feed.connected()) return;

    setPending(undefined);
    if (intent.kind === "recheck") {
      if (
        !result &&
        document.activeElement?.closest(".record-permission-controls")
      )
        accessHeading.current?.focus();
    } else if (intent.kind === "screen-selection") {
      setSaveError(
        saved?.screenSelection !== (intent.skip ? "full-display" : "picker"),
      );
    } else if (row && result) {
      setFeedback({
        row,
        message: errors[result] ?? errors.failed,
        error: true,
      });
    } else if (
      row &&
      intent.kind === "repair" &&
      intent.repair === "copy-input"
    ) {
      setFeedback({ row, message: "Command copied.", error: false });
    }
  }

  const selection = state?.screenSelection;
  const fullDisplay = selection === "full-display";
  const accessError = snapshot?.phase === "unavailable";
  return (
    <div className="record-permissions">
      <section
        className="record-permission-group"
        aria-labelledby="record-app-access"
      >
        <h2 ref={accessHeading} id="record-app-access" tabIndex={-1}>
          App access
        </h2>
        {(!snapshot || snapshot.phase === "checking") && (
          <p role="status">Checking access…</p>
        )}
        {accessError && (
          <div className="record-permission-controls">
            <p role="alert">Couldn’t check app access.</p>
            <Button
              variant="outline"
              aria-disabled={Boolean(pending)}
              onClick={() => void act({ kind: "recheck" })}
            >
              {pending?.kind === "recheck" ? "Checking…" : "Check again"}
            </Button>
          </div>
        )}
        {state && (
          <ul>
            {state.rows.map((row) => (
              <PermissionItem
                key={row.permission}
                row={row}
                platform={state.platform}
                pending={Boolean(pending)}
                checked={state.accessChecked}
                feedback={
                  feedback?.row === row.permission ? feedback : undefined
                }
                act={(intent) => void act(intent, row.permission)}
              />
            ))}
          </ul>
        )}
      </section>
      <section
        className="record-screen-selection"
        aria-labelledby="recording-start"
      >
        <h2 id="recording-start" tabIndex={-1}>
          Screen recording
        </h2>
        <div className="record-screen-selection-row">
          <label htmlFor="record-skip-selection">Skip screen selection</label>
          <Switch
            id="record-skip-selection"
            checked={fullDisplay}
            disabled={!selection || selection === "unavailable"}
            aria-busy={pending?.kind === "screen-selection" || undefined}
            aria-disabled={Boolean(pending) || undefined}
            aria-describedby="record-screen-selection-help"
            onCheckedChange={(skip) =>
              void act({ kind: "screen-selection", skip })
            }
          />
          <div id="record-screen-selection-help">
            {!selection ? (
              <p>
                {accessError
                  ? "Screen selection couldn’t be read."
                  : "Checking screen selection…"}
              </p>
            ) : selection === "unavailable" ? (
              <p>Screen selection is unavailable in this session.</p>
            ) : fullDisplay ? (
              <p>
                Record one entire display. Your system may still ask for
                approval.
              </p>
            ) : (
              <>
                <p>By default, your system asks what to share.</p>
                <p>
                  Your system may still ask for approval when you skip
                  selection.
                </p>
                {state?.platform === "macos" && (
                  <p>
                    Typed notes are unavailable when you use the system picker.
                  </p>
                )}
              </>
            )}
          </div>
          {saveError && (
            <p role="alert">
              Couldn’t confirm screen selection. Try the switch again.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function PermissionItem({
  row,
  platform,
  pending,
  checked,
  feedback,
  act,
}: {
  row: PermissionRow;
  platform: PermissionState["platform"];
  pending: boolean;
  checked: boolean;
  feedback?: Feedback;
  act(intent: PermissionIntent): void;
}) {
  const input = platform === "wayland" && row.permission === "accessibility";
  const name = input ? "Input devices" : permissionNames[row.permission];
  const description = input
    ? "Read clicks and Shift ink over other apps."
    : descriptions[row.permission];
  const Icon = input ? Mouse : icons[row.permission];
  const repair = row.repair;
  const allowed = checked && row.status === "granted" && !row.relaunch;
  const unknown = !checked || row.status === "unavailable";
  const label = row.relaunch
    ? "Reopen Apparent"
    : repair === "none"
      ? null
      : actions[repair];

  return (
    <li className="record-permission-row">
      <Icon className="record-permission-icon" aria-hidden="true" />
      <div className="record-permission-description">
        <h3 tabIndex={-1}>{name}</h3>
        <p>{description}</p>
      </div>
      <div className="record-permission-status">
        {allowed ? (
          <CircleCheck role="img" aria-label="Allowed" />
        ) : (
          <>
            {!unknown && (
              <CircleAlert
                className="record-permission-warning"
                aria-hidden="true"
              />
            )}
            <span>
              {unknown
                ? "Unknown"
                : row.relaunch
                  ? "Reopen required"
                  : "Access needed"}
            </span>
          </>
        )}
      </div>
      {!unknown && label && (
        <div className="record-permission-action">
          {row.required && <p>Required to record.</p>}
          <Button
            variant="outline"
            aria-disabled={pending}
            aria-label={`${label} · ${name}`}
            onClick={() => {
              if (row.relaunch) act({ kind: "reopen" });
              else if (repair !== "none")
                act({ kind: "repair", permission: row.permission, repair });
            }}
          >
            {label}
          </Button>
          {repair === "copy-input" && (
            <p>Run it in a terminal, then log out and back in.</p>
          )}
        </div>
      )}
      {feedback && (
        <p
          className="record-permission-feedback"
          role={feedback.error ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      )}
    </li>
  );
}
