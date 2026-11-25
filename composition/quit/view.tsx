import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@apparent/ui/button";
import { ErrorDialog } from "@apparent/ui/error-dialog";
import "@apparent/ui/tokens.css";
import "./view.css";

type State = {
  checked: boolean;
  available: boolean;
  needsApproval: boolean;
  desktopShortcutPossible: boolean;
};

type StartError = {
  kind: "record-start-error";
  title: string;
  description: string;
};

declare global {
  interface Window {
    apparentQuit: {
      state(): Promise<State | StartError>;
      decide(quit: boolean, checked: boolean | null): Promise<boolean>;
      close(): void;
    };
  }
}

function QuitDialog({ state }: { state: State }) {
  const [checked, setChecked] = useState(state.checked);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<boolean | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const focusKeep = useCallback((button: HTMLButtonElement | null) => {
    keep.current = button;
    button?.focus();
  }, []);

  async function decide(quit: boolean) {
    if (pending) return;
    setFailed(null);
    setPending(true);
    const preference =
      state.available && checked !== state.checked ? checked : null;
    const saved = await window.apparentQuit
      .decide(quit, preference)
      .catch(() => false);
    if (saved) window.apparentQuit.close();
    else {
      setPending(false);
      setFailed(quit);
    }
  }

  return (
    <main
      aria-labelledby="quit-title"
      aria-busy={pending}
      onKeyDown={(event) => {
        if (event.key === "Escape" && failed === null) {
          event.preventDefault();
          void decide(false);
        }
      }}
    >
      <h1 id="quit-title">Are you sure?</h1>
      {state.desktopShortcutPossible ? (
        <p>
          If your Record shortcut stops working after you quit, reopen Apparent
          to use it again.
        </p>
      ) : (
        <p>
          Your Record shortcut won’t work after you quit. Reopen Apparent to use
          it again.
        </p>
      )}
      {state.available && (
        <label>
          <input
            type="checkbox"
            checked={checked}
            disabled={pending}
            onChange={(event) => setChecked(event.target.checked)}
          />
          Start Apparent when I sign in
        </label>
      )}
      {state.needsApproval && checked && (
        <p>Allow Apparent in your system’s startup settings to finish setup.</p>
      )}
      <div className="quit-actions">
        <Button disabled={pending} onClick={() => void decide(true)}>
          Quit
        </Button>
        <Button
          ref={focusKeep}
          disabled={pending}
          variant="outline"
          onClick={() => void decide(false)}
        >
          Keep shortcut active
        </Button>
      </div>
      <ErrorDialog
        open={failed !== null}
        title="Couldn’t change startup settings"
        description="Apparent is still running. Try again or change your choice."
        recoveryLabel="Try again"
        onRecover={() => {
          if (failed !== null) void decide(failed);
        }}
        onClose={() => setFailed(null)}
        restoreFocus={() => keep.current?.focus()}
      />
    </main>
  );
}

void window.apparentQuit
  .state()
  .then((state) => {
    createRoot(document.getElementById("root")!).render(
      "kind" in state ? (
        <ErrorDialog
          open
          title={state.title}
          description={state.description}
          onClose={() => window.apparentQuit.close()}
        />
      ) : (
        <QuitDialog state={state} />
      ),
    );
  })
  .catch(() => window.apparentQuit.close());
