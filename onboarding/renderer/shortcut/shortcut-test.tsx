import { Keycap } from "@apparent/ui/keycap";
import type { HTMLAttributes, Ref } from "react";
import "./shortcut-test.css";

type Props = {
  shortcut: string;
  keys: string[];
  editing: boolean;
  tested: boolean;
  heldKeys: string[];
  error: string | null;
  recorderRef: Ref<HTMLDivElement>;
  recorderEvents: HTMLAttributes<HTMLDivElement>;
};

export function ShortcutTest({
  shortcut,
  keys,
  editing,
  tested,
  heldKeys,
  error,
  recorderRef,
  recorderEvents,
}: Props) {
  const visibleKeys = editing ? (heldKeys.length ? heldKeys : ["…"]) : keys;
  return (
    <div className="shortcut-test" data-detected={tested && !editing}>
      <h1>
        {editing
          ? "Choose a different shortcut."
          : "Test your recording shortcut."}
      </h1>
      <p id="shortcut-instructions">
        {editing ? (
          "Press the keys you want to use."
        ) : shortcut ? (
          <>
            Press and release <strong>{shortcut}</strong>.
          </>
        ) : (
          "Choose a shortcut to test."
        )}
      </p>
      <div
        className="shortcut-test-stage"
        ref={editing ? recorderRef : undefined}
        {...(editing ? recorderEvents : {})}
        role={editing ? "group" : undefined}
        aria-label={editing ? "Shortcut recorder" : undefined}
        aria-describedby={
          editing ? "shortcut-instructions shortcut-status" : undefined
        }
        tabIndex={editing ? 0 : undefined}
      >
        <div className="shortcut-test-keys" aria-hidden="true">
          {visibleKeys.filter(Boolean).map((key) => (
            <Keycap key={key} pressed={editing && heldKeys.length > 0}>
              {key === "Fn" ? (
                <>
                  fn
                  <span className="shortcut-test-globe" />
                </>
              ) : (
                key
              )}
            </Keycap>
          ))}
        </div>
        <span className="shortcut-test-pebble" aria-hidden="true">
          <span />
        </span>
      </div>
      <p
        className="shortcut-test-status"
        id="shortcut-status"
        role={error ? "alert" : "status"}
      >
        {error ??
          (editing
            ? "Press Esc to keep your current shortcut."
            : tested
              ? "Shortcut detected."
              : "")}
      </p>
    </div>
  );
}
