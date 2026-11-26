import { Button } from "@apparent/ui/button";
import { Input } from "@apparent/ui/input";
import { NativeSelect, NativeSelectOption } from "@apparent/ui/native-select";
import { Switch } from "@apparent/ui/switch";
import { useState, useSyncExternalStore } from "react";

type Facts = { saved: boolean; enabled: boolean; model: string };

type Action =
  | { action: "read" | "remove" }
  | { action: "save"; key: string }
  | { action: "choose"; model: string; enabled: boolean };

declare global {
  interface Window {
    apparentOpenRouter?: (action: Action) => Promise<Facts>;
  }
}

function credentialFeed() {
  let snapshot: { facts?: Facts; failed?: boolean } = {};
  return {
    snapshot: () => snapshot,
    subscribe: (change: () => void) => {
      let subscribed = true;
      void window.apparentOpenRouter?.({ action: "read" }).then(
        (facts) => {
          if (subscribed) {
            snapshot = { facts };
            change();
          }
        },
        () => {
          if (subscribed) {
            snapshot = { failed: true };
            change();
          }
        },
      );
      return () => {
        subscribed = false;
      };
    },
  };
}

export function OpenRouterExperiment() {
  const [feed] = useState(credentialFeed);
  const loaded = useSyncExternalStore(feed.subscribe, feed.snapshot);
  const [saved, setFacts] = useState<Facts>();
  const facts = saved ?? loaded.facts;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setError] = useState("");
  const error =
    failure ||
    (!saved && loaded.failed
      ? "Couldn’t read the saved key. Remove it and save a new one."
      : "");

  async function act(action: Action) {
    const bridge = window.apparentOpenRouter;
    if (!bridge || busy) return;
    setBusy(true);
    setError("");
    try {
      setFacts(await bridge(action));
      if (action.action === "save" || action.action === "remove") setKey("");
    } catch {
      setError(
        action.action === "save"
          ? "Couldn’t save the key. Check the key and try again."
          : "Couldn’t update OpenRouter transcription. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!window.apparentOpenRouter) return null;

  return (
    <section className="agent-preference" aria-labelledby="openrouter-title">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="openrouter-title">
          OpenRouter transcription
        </h2>
        <Switch
          className="agent-switch"
          aria-labelledby="openrouter-title"
          aria-describedby="openrouter-help"
          checked={facts?.enabled ?? false}
          disabled={!facts?.saved || busy}
          onCheckedChange={(enabled) => {
            if (facts)
              void act({ action: "choose", enabled, model: facts.model });
          }}
        />
      </div>
      <p id="openrouter-help">
        When enabled, Stop sends microphone audio to OpenRouter and Microsoft
        Azure using your credits. If transcription fails, Apparent uses your
        usual transcriber.
      </p>
      <form
        className="mt-4 grid min-w-0 gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void act({ action: "save", key: key.trim() });
        }}
      >
        <label htmlFor="openrouter-key">OpenRouter API key</label>
        <Input
          id="openrouter-key"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={256}
          value={key}
          disabled={busy}
          placeholder={facts?.saved ? "Key saved" : undefined}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="secondary"
            disabled={busy || !key.trim()}
          >
            Save key
          </Button>
          {(facts?.saved || (!facts && error)) && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void act({ action: "remove" })}
            >
              Remove key
            </Button>
          )}
        </div>
      </form>
      <div className="mt-4 grid gap-2">
        <label htmlFor="openrouter-model">Model</label>
        <NativeSelect
          id="openrouter-model"
          value={facts?.model ?? "microsoft/mai-transcribe-2"}
          disabled={!facts?.saved || busy}
          onChange={(event) => {
            if (facts)
              void act({
                action: "choose",
                model: event.currentTarget.value,
                enabled: facts.enabled,
              });
          }}
        >
          <NativeSelectOption value="microsoft/mai-transcribe-2">
            MAI-Transcribe 2
          </NativeSelectOption>
        </NativeSelect>
      </div>
      {error && <p role="alert">{error}</p>}
      <span className="sr-only" role="status">
        {busy
          ? "Saving OpenRouter preference"
          : facts?.saved
            ? "Key saved"
            : ""}
      </span>
    </section>
  );
}
