import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@apparent/ui/button";
import { Switch } from "@apparent/ui/switch";
import { bindPreference } from "../../shared/settings/binding";
import policy from "../pure/auto-paste-preference.mjs";
import type { AutoPasteBridge } from "./auto-paste-host";

export function AutoPaste({ bridge }: { bridge: AutoPasteBridge }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(false);
  const section = useRef<HTMLElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const focusOrigin = useRef<Element | null>(null);

  async function request(next?: boolean) {
    if (pending.current) return;
    const active = document.activeElement;
    focusOrigin.current =
      active === section.current?.querySelector("#auto-paste-toggle") ||
      active === retry.current
        ? active
        : null;
    pending.current = true;
    setBusy(true);
    try {
      const saved = await (next === undefined
        ? bridge.read()
        : bridge.save(next));
      if (!mounted.current) return;
      setEnabled(saved);
      setError("");
    } catch {
      if (!mounted.current) return;
      setEnabled(null);
      setError(
        next === undefined
          ? "Couldn’t read the Auto paste preference."
          : "Couldn’t confirm the change to Auto paste.",
      );
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useLayoutEffect(() => {
    mounted.current = true;
    const unsubscribe = bridge.subscribe((saved) => {
      if (pending.current) return;
      setEnabled(saved);
      setError(
        saved === null ? "Couldn’t read the Auto paste preference." : "",
      );
    });
    void request();
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [bridge]);

  useLayoutEffect(() => {
    if (busy || !focusOrigin.current) return;
    const original = focusOrigin.current;
    focusOrigin.current = null;
    if (
      document.activeElement === document.body ||
      document.activeElement === original
    ) {
      (error
        ? retry.current
        : section.current?.querySelector<HTMLButtonElement>(
            "#auto-paste-toggle",
          )
      )?.focus({ preventScroll: true });
    }
  }, [busy, error]);

  return (
    <section ref={section} className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="auto-paste-label">
          Auto paste
        </h2>
        <Switch
          id="auto-paste-toggle"
          className="agent-switch"
          checked={enabled ?? undefined}
          aria-labelledby="auto-paste-label"
          aria-describedby="auto-paste-help auto-paste-fallback"
          aria-busy={busy}
          disabled={!policy.can_toggle(enabled !== null, busy)}
          onCheckedChange={bindPreference(
            "handoff",
            "labs.autoPasteDraft",
            (value) => void request(value),
          )}
        />
      </div>
      <p id="auto-paste-help">
        Finish pastes your recording details into the focused draft field. Keep
        that field focused until the draft appears. You decide when to send.
      </p>
      <p id="auto-paste-fallback">
        You can also use Paste on the saved recording.
      </p>
      {error && (
        <>
          <p role="alert">{error}</p>
          <Button
            ref={retry}
            variant="secondary"
            disabled={busy}
            onClick={() => void request()}
          >
            Refresh preference
          </Button>
        </>
      )}
      <span role="status" className="sr-only">
        {busy ? "Checking Auto paste preference" : ""}
      </span>
    </section>
  );
}
