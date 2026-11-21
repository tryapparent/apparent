import { useRef, useState, type ReactNode } from "react";
import { Button } from "@apparent/ui/button";
import { StickyNote } from "@apparent/ui/icons";
import type { PillView } from "./view";
import type { LipStatus } from "../input/renderer";
import { InputMeter } from "./input-meter";
import { LiveCaption } from "./live-caption";
import {
  Check,
  Circle,
  CircleAlert,
  ClipboardPaste,
  Link,
  LoaderCircle,
  Monitor,
  PenLine,
  Scan,
  ScanEye,
  Smartphone,
  Square,
  X,
  type LucideIcon,
} from "lucide-react";
import "./surface.css";
const actionIcons: Record<string, LucideIcon> = {
  "select-area": Scan,
  "switch-area": Scan,
  "select-screen": Monitor,
  "switch-screen": Monitor,
  "select-iphone": Smartphone,
  "switch-iphone": Smartphone,
  record: Circle,
  whiteboard: PenLine,
  finish: Square,
  paste: ClipboardPaste,
  "copy-link": Link,
  inspect: ScanEye,
  cancel: X,
  dismiss: X,
};

export type BackgroundHandoff = {
  phase: "processing" | "sent" | "attention";
  count: number;
  title: string;
  retry: string | null;
};

function backgroundLabel(handoff: BackgroundHandoff) {
  return handoff.phase === "processing" ? "Preparing recording for T3 Code"
    : handoff.phase === "sent" ? "Sent to T3 Code"
    : handoff.retry ? "T3 delivery needs attention" : "Recording could not be prepared";
}

function BackgroundTab({ handoff, open, toggle }: { handoff: BackgroundHandoff; open: boolean; toggle: () => void }) {
  const processing = handoff.phase === "processing";
  const label = backgroundLabel(handoff);
  return (
    <div className="pill-background-layer">
      <span className="sr-only" role="status">{label}</span>
      <Button className="pill-extension pill-background" variant="ghost"
        aria-label={processing ? `${handoff.count} previous ${handoff.count === 1 ? "recording" : "recordings"} processing` : label}
        aria-expanded={open} onClick={toggle}>
        {processing ? <><LoaderCircle aria-hidden="true" className="background-spinner" /><span>{handoff.count}</span></>
          : handoff.phase === "sent" ? <Check aria-hidden="true" /> : <CircleAlert aria-hidden="true" />}
      </Button>
    </div>
  );
}

type Props = {
  view: PillView;
  lipStatus?: LipStatus | null;
  onRetryBackground?: (capture: string) => Promise<void>;
  backgroundHandoff?: BackgroundHandoff | null;
  pending?: boolean;
  controlsDisabled?: boolean;
  children?: ReactNode;
  error?: boolean;
  receivedAt?: number;
  reduced?: boolean;
  manualDrag?: boolean;
  onAction: (action: string, drop?: boolean) => void;
  onBeginDrag?: () => Promise<void>;
  onBeginPaste?: () => Promise<void>;
  onCancelPaste?: () => void;
};
export function PillSurface({
  view,
  lipStatus,
  backgroundHandoff,
  onRetryBackground,
  pending = false,
  controlsDisabled = false,
  children,
  error = false,
  receivedAt = 0,
  reduced = false,
  manualDrag = false,
  onAction,
  onBeginDrag,
  onBeginPaste,
  onCancelPaste,
}: Props) {
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState(false);
  async function retryBackground(capture: string) {
    if (!onRetryBackground || retrying) return;
    setRetrying(true);
    setRetryError(false);
    try { await onRetryBackground(capture); }
    catch { setRetryError(true); }
    finally { setRetrying(false); }
  }
  const pasteStart = useRef<[number, number] | null>(null);
  const uploading = view.shareIndicator === "uploading";
  const uploadStopped = view.shareIndicator === "retry";
  const microphoneInput = view.phase === "recording" ? view.inputWaveform : null;
  const isClose = (id: string) => id === "cancel" || id === "dismiss";
  const controls = view.actions
    .filter((action) => action.id !== "notes")
    .sort((a, b) => Number(isClose(a.id)) - Number(isClose(b.id)));
  const pasteIndex = controls.findIndex((action) => action.id === "paste");
  const inspectIndex = controls.findIndex((action) => action.id === "inspect");
  if (pasteIndex >= 0 && inspectIndex > pasteIndex)
    [controls[pasteIndex], controls[inspectIndex]] = [
      controls[inspectIndex],
      controls[pasteIndex],
    ];
  return (
    <main
      data-revision={view.revision}
      className="pill apparent-theme"
      aria-label={view.phase === "selecting" ? view.label : undefined}
      data-phase={view.phase}
      data-reduced={view.reducedMotion}
      data-warning={view.warning !== null}
      data-live={view.phase === "recording" && !!view.transcript}
    >
      <div className="pill-surface" data-background={view.phase === "recording" && !!backgroundHandoff}>
        {view.phase === "recording" && backgroundHandoff && <BackgroundTab handoff={backgroundHandoff} open={backgroundOpen} toggle={() => setBackgroundOpen(!backgroundOpen)} />}
        <div className="pill-row">
          {view.phase !== "selecting" && (
            <div
              className={`lead ${view.draggable ? "movable" : ""} ${manualDrag ? "manual-drag" : ""}`}
              title={view.draggable ? "Drag recording controls" : undefined}
              onPointerDown={(event) => {
                if (
                  view.draggable &&
                  !(event.target as HTMLElement).closest("button") &&
                  manualDrag &&
                  event.button === 0 &&
                  event.isPrimary
                )
                  void onBeginDrag?.().catch(() => {});
              }}
            >
              <span
                className={`indicator-slot ${view.phase}`}
                data-bloom={microphoneInput !== null}
              >
                {microphoneInput !== null && (
                  <InputMeter
                    input={microphoneInput}
                    receivedAt={receivedAt}
                    reduced={view.reducedMotion || reduced}
                  />
                )}
                {uploading ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="indicator processing"
                  />
                ) : uploadStopped ? (
                  <CircleAlert
                    aria-hidden="true"
                    className="indicator stopped"
                  />
                ) : view.phase === "completed" ? (
                  <Check aria-hidden="true" className="indicator completed" />
                ) : view.phase === "processing" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="indicator processing"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`indicator ${view.phase}`}
                  />
                )}
              </span>
              <span
                className="clock"
                role={view.phase === "completed" ? "status" : undefined}
                aria-label={
                  view.phase === "recording"
                    ? `Recording ${view.clock}`
                    : undefined
                }
              >
                {view.phase === "recording"
                  ? view.clock
                  : view.phase === "processing"
                    ? "Processing…"
                    : view.label}
              </span>
            </div>
          )}
          {lipStatus && <span className="notice" role="status">{lipStatus}</span>}
          {view.warning && view.warning !== view.label && (
            <span className="warning" role="status">
              {view.warning}
            </span>
          )}
          {(view.notice || view.noteTip) && (
            <span className="notice" role="status">
              {view.notice || view.noteTip}
            </span>
          )}
          {error && (
            <span role="alert">
              Action not confirmed. Use the recording shortcut or tray menu.
            </span>
          )}
          {view.actions.length > 0 && (
            <div
              className="controls"
              role="group"
              aria-label="Recording controls"
              aria-busy={pending}
            >
              {controls.map((action) => {
                const Icon =
                  action.id === "copy-link" && uploading
                    ? X
                    : actionIcons[action.id];
                const iconOnly = isClose(action.id);
                return (
                  <Button
                    key={action.id}
                    variant={
                      action.primary
                        ? "default"
                        : action.selected
                          ? "secondary"
                          : "ghost"
                    }
                    size={iconOnly ? "icon" : "default"}
                    data-icon-only={iconOnly}
                    aria-label={action.label}
                    title={iconOnly ? action.label : undefined}
                    data-primary={action.primary}
                    data-action={action.id}
                    aria-pressed={
                      action.id.startsWith("select-")
                        ? action.selected
                        : undefined
                    }
                    disabled={!action.enabled || pending || controlsDisabled}
                    onPointerDown={(event) => {
                      if (
                        action.id === "paste" &&
                        event.button === 0 &&
                        event.isPrimary
                      ) {
                        pasteStart.current = [event.screenX, event.screenY];
                        event.currentTarget.setPointerCapture(event.pointerId);
                        void onBeginPaste?.().catch(() => {
                          pasteStart.current = null;
                        });
                      }
                    }}
                    onPointerUp={(event) => {
                      if (
                        action.id === "paste" &&
                        event.button === 0 &&
                        event.isPrimary &&
                        pasteStart.current
                      ) {
                        const [x, y] = pasteStart.current;
                        pasteStart.current = null;
                        void onAction(
                          "paste",
                          Math.hypot(event.screenX - x, event.screenY - y) >=
                            24,
                        );
                      }
                    }}
                    onPointerCancel={() => {
                      pasteStart.current = null;
                      void onCancelPaste?.();
                    }}
                    onClick={(event) => {
                      if (action.id !== "paste" || event.detail === 0)
                        void onAction(action.id);
                    }}
                  >
                    {Icon && <Icon aria-hidden="true" />}
                    {!iconOnly && <span>{action.label}</span>}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
        {view.phase === "recording" && view.transcript && (
          <LiveCaption value={view.transcript} />
        )}
        {view.phase === "recording" && view.noteCount > 0 && (
          <div className="pill-notes-layer">
            <Button
              className="pill-extension pill-notes"
              variant="ghost"
              aria-label={`${view.noteCount} saved ${view.noteCount === 1 ? "note" : "notes"}. Open notes`}
              disabled={
                pending ||
                !view.actions.some((a) => a.id === "notes" && a.enabled)
              }
              onClick={() => void onAction("notes")}
            >
              <StickyNote aria-hidden="true" />
              <span>{view.noteCount > 99 ? "99+" : view.noteCount}</span>
            </Button>
          </div>
        )}
      </div>
      {view.phase === "recording" && backgroundHandoff && backgroundOpen &&
        <div className="pill-background-detail" role="status">
          <strong>{backgroundHandoff.title}</strong><span>{backgroundLabel(backgroundHandoff)}</span>
          {backgroundHandoff.retry && <Button variant="outline" disabled={retrying}
            onClick={() => void retryBackground(backgroundHandoff.retry!)}>Retry same send</Button>}
          {retryError && <span role="alert">Retry could not be confirmed.</span>}
        </div>}
      {children}
    </main>
  );
}
