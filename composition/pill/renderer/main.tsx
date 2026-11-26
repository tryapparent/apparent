import { useLayoutEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@apparent/ui/button";
import { StatusCard } from "@apparent/ui/status-card";
import { createPillSession } from "./session";
import "./style.css";
import "@apparent/ui/status.css";
import { DestinationPicker } from "./destination-picker";
import "../../../handoff/renderer/picker.css";
import { PillSurface } from "../../../record/pill/renderer/pill-view";

const session = createPillSession(window.apparentPill);

function Pill() {
  const {
    view,
    handoffLoaded,
    destination,
    background,
    receivedAt,
    systemReduced,
    sharing,
    pending,
    error,
  } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { act } = session;
  const showingDestination =
    !!destination && !!view && ["processing", "completed"].includes(view.phase);
  useLayoutEffect(() => {
    if (!view || !handoffLoaded) return;
    let active = true,
      last = "";
    const report = () => {
      if (!active) return;
      const rect = document.querySelector("main")?.getBoundingClientRect();
      const key = JSON.stringify([rect?.width, rect?.height]);
      if (key === last) return;
      last = key;
      void window.apparentPill?.layout(view.revision).catch(() => {});
    };

    report();
    const observer = new ResizeObserver(report),
      element = document.querySelector("main");
    if (element) observer.observe(element);
    void document.fonts.ready.then(report);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [view?.revision, view?.phase, showingDestination, handoffLoaded]);
  if (!view)
    return (
      <div role="status" className="pill connection">
        {error ? "Recording controls unavailable" : "Connecting…"}
      </div>
    );
  if (view.phase === "hidden" || !handoffLoaded) return null;
  const confirmation = sharing === view.revision && (
    <section
      className="public-share-confirmation"
      aria-label="Confirm public sharing"
    >
      <StatusCard tone="neutral" headline="Create a public link?" compact>
        <p>
          Anyone with this link can view this capture. Shared captures are not
          end-to-end encrypted.
        </p>
        <div className="public-share-actions">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void act("cancel-public-link")}
          >
            Cancel sharing
          </Button>
          <Button
            disabled={pending}
            onClick={() => void act("confirm-public-link")}
          >
            Create public link
          </Button>
        </div>
      </StatusCard>
    </section>
  );
  const shareAction = view.actions.find((action) => action.id === "copy-link");
  if (showingDestination && destination)
    return (
      <main
        data-revision={view.revision}
        className="pill apparent-theme pill-destination"
        data-phase={view.phase}
        data-reduced={view.reducedMotion}
      >
        <DestinationPicker
          key={destination.capture}
          view={destination}
          disabled={pending || sharing !== null}
          shareAction={shareAction}
          onShare={() => void act("copy-link")}
        />
        {shareAction && (view.shareIndicator ?? "none") !== "none" && (
          <div
            className="destination-notification destination-receipt"
            role="status"
          >
            {view.label}
          </div>
        )}
        {error && (
          <div className="destination-notification">
            <StatusCard tone="failure" headline="Action not confirmed" compact>
              <p>Try Public link again.</p>
            </StatusCard>
          </div>
        )}
        {confirmation}
      </main>
    );
  return (
    <PillSurface
      view={view}
      backgroundHandoff={background}
      onRetryBackground={(key) =>
        window.apparentPill!.retryBackgroundHandoff(key)
      }
      pending={pending}
      controlsDisabled={sharing !== null}
      error={error}
      receivedAt={receivedAt}
      reduced={systemReduced}
      manualDrag={window.apparentPill?.manualDrag}
      onAction={(id, drop) => void act(id, drop)}
      onBeginDrag={() => window.apparentPill!.beginDrag(view.revision)}
      onBeginPaste={() => window.apparentPill!.beginPaste(view.revision)}
      onCancelPaste={() => void window.apparentPill?.cancelPaste()}
    >
      {view.copyFailed && (
        <div className="destination-notification pill-completion-notification">
          <StatusCard
            tone="failure"
            headline="Couldn’t copy the recording"
            compact
          >
            <p>Your recording is saved.</p>
            {view.actions.some(
              (action) => action.id === "inspect" && action.enabled,
            ) && (
              <div className="destination-recovery">
                <Button
                  variant="outline"
                  disabled={pending || sharing !== null}
                  onClick={() => void act("inspect")}
                >
                  Inspect recording
                </Button>
              </div>
            )}
          </StatusCard>
        </div>
      )}
      {confirmation}
    </PillSurface>
  );
}

createRoot(document.getElementById("root")!).render(<Pill />);
