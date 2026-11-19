import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "@apparent/ui/button";
import { Input } from "@apparent/ui/input";
import { StatusCard } from "@apparent/ui/status-card";
import {
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  LoaderCircle,
  MessageSquare,
  PauseCircle,
  Pin,
  Search,
  SquareCheck,
  X,
} from "lucide-react";
import {
  destinationLabels,
  filterDestinations,
  type Destination,
  type DestinationView,
} from "../pure/destinations.ts";

const icons = {
  new: MessageSquare,
  pinned: Pin,
  active: MessageSquare,
  done: SquareCheck,
  working: Clock,
  snoozed: PauseCircle,
  settled: CircleCheck,
};

type Action = "choose" | "retry" | "cancel" | "dismiss" | "copy" | "setup";
type Props = {
  view: DestinationView;
  disabled?: boolean;
  shareAction?: { label: string; enabled: boolean };
  onShare?: () => void;
  onAction: (action: Action, id?: string) => Promise<DestinationView | null>;
  onFocus: (active: boolean) => Promise<unknown>;
};

const location = (choice: Destination) =>
  [choice.computer, choice.project].filter(Boolean).join(" · ");

export function T3DestinationPicker({
  view,
  disabled,
  shareAction,
  onShare,
  onAction,
  onFocus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string>();
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [localBusy, setBusy] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const restore = useRef(false);
  const scrollSelection = useRef(false);
  const initialFocus = useRef(false);
  const pending = useRef(false);
  const retry = useRef<HTMLButtonElement>(null);

  const busy = disabled || localBusy;
  const canChoose =
    view.phase === "choosing" || (view.phase === "error" && !view.confirmed);
  const searching = open && canChoose;
  const chosen =
    view.confirmed ??
    view.choices.find((choice) => choice.id === view.selected) ??
    view.choices[0];
  const choices = filterDestinations(view.choices, query);
  const active =
    choices.find((choice) => choice.id === activeId) ??
    (query.trim()
      ? choices[0]
      : choices.find((choice) => choice.id === chosen?.id));
  const index = active ? choices.indexOf(active) : -1;
  const progress = view.processing || view.phase === "sending";
  const status =
    view.phase === "sent"
      ? "Submitted"
      : progress
        ? "Processing recording"
        : "Recording saved";
  const failed = view.phase === "error" || view.phase === "uncertain" || error;
  const retrySame =
    !!view.confirmed && (view.phase === "error" || view.phase === "uncertain");

  function mountTrigger(button: HTMLButtonElement | null) {
    trigger.current = button;
    if (initialFocus.current || !button || button.disabled) return;
    initialFocus.current = true;
    void onFocus(true)
      .then(() => trigger.current?.focus({ preventScroll: true }))
      .catch(() => {});
  }

  useLayoutEffect(() => {
    if (searching) search.current?.focus({ preventScroll: true });
    else if (restore.current) {
      restore.current = false;
      trigger.current?.focus({ preventScroll: true });
    }
  }, [searching]);

  useLayoutEffect(() => {
    if (retrySame && !busy && document.hasFocus())
      retry.current?.focus({ preventScroll: true });
  }, [retrySame, busy]);

  function updateFade() {
    const tray = list.current;
    setMore(
      !!tray && tray.scrollHeight - tray.scrollTop - tray.clientHeight > 1,
    );
  }

  useLayoutEffect(() => {
    const tray = list.current;
    if (!searching || !tray) return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(tray);
    updateFade();
    return () => observer.disconnect();
  }, [searching]);

  useLayoutEffect(() => {
    if (scrollSelection.current && list.current) {
      scrollSelection.current = false;
      list.current
        .querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }
    updateFade();
  }, [searching, index, choices.length]);

  function changeQuery(value: string) {
    setQuery(value);
    setActiveId(undefined);
    if (list.current) list.current.scrollTop = 0;
  }

  function expand(value = "") {
    if (!canChoose || !chosen || busy) return;
    changeQuery(value);
    setOpen(true);
    void onFocus(true).catch(() => {});
  }

  function collapse() {
    restore.current = true;
    setOpen(false);
    changeQuery("");
    void onFocus(false).catch(() => {});
  }

  async function act(action: Action, id?: string) {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const result = await onAction(action, id);
      if (action === "copy") setCopied(true);
      if (action === "choose" || action === "dismiss") {
        setOpen(false);
        changeQuery("");
        if (result?.phase !== "uncertain" && result?.phase !== "error")
          void onFocus(false).catch(() => {});
      }
    } catch {
      setError("Action not confirmed. Try again or copy the recording.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="destination-stack" data-open={searching} aria-busy={busy}>
      <div className="destination-assembly">
        <div className="destination-pill">
          <span
            className="destination-status"
            role={progress && view.phase !== "sent" ? "progressbar" : "img"}
            aria-label={status}
          >
            {progress && view.phase !== "sent" ? (
              <LoaderCircle
                className="destination-spinner"
                aria-hidden="true"
              />
            ) : (
              <Check aria-hidden="true" />
            )}
          </span>
          {view.phase === "setup" ? (
            <Button
              disabled={busy}
              className="destination-trigger"
              onClick={() => void act("setup")}
            >
              Connect T3
            </Button>
          ) : searching ? (
            <div className="destination-search">
              <Search aria-hidden="true" />
              <Input
                ref={search}
                role="combobox"
                aria-label="Search threads"
                aria-expanded
                aria-controls="destination-options"
                aria-autocomplete="list"
                aria-activedescendant={
                  index < 0 ? undefined : "destination-option-" + index
                }
                placeholder="Search threads…"
                autoComplete="off"
                spellCheck={false}
                value={query}
                readOnly={busy}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    collapse();
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    if (active) void act("choose", active.id);
                  } else if (
                    event.key === "ArrowDown" ||
                    event.key === "ArrowUp"
                  ) {
                    event.preventDefault();
                    const next =
                      index < 0
                        ? event.key === "ArrowDown"
                          ? 0
                          : choices.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              choices.length - 1,
                              index + (event.key === "ArrowDown" ? 1 : -1),
                            ),
                          );
                    scrollSelection.current = true;
                    setActiveId(choices[next]?.id);
                  }
                }}
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="destination-clear"
                  aria-label="Clear search"
                  disabled={busy}
                  onClick={() => {
                    changeQuery("");
                    search.current?.focus({ preventScroll: true });
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              )}
            </div>
          ) : (
            <Button
              ref={mountTrigger}
              variant="secondary"
              className="destination-trigger"
              role="combobox"
              aria-haspopup="listbox"
              aria-expanded={false}
              aria-label={
                chosen
                  ? [
                      chosen.title,
                      "recording destination",
                      chosen.computer,
                      chosen.project,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : "Loading T3 threads"
              }
              title={
                chosen
                  ? [chosen.title, location(chosen)].filter(Boolean).join(" · ")
                  : undefined
              }
              disabled={!canChoose || busy || !chosen}
              onClick={() => expand()}
              onKeyDown={(event) => {
                if (
                  !chosen ||
                  !canChoose ||
                  event.nativeEvent.isComposing ||
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey
                )
                  return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void act("choose", chosen.id);
                } else if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp"
                ) {
                  event.preventDefault();
                  expand();
                } else if (event.key.length === 1 && event.key.trim()) {
                  event.preventDefault();
                  expand(event.key);
                }
              }}
            >
              <span className="destination-label">
                <span>{chosen?.title ?? "Loading T3 threads…"}</span>
                <small>{chosen && location(chosen)}</small>
              </span>
              <ChevronDown aria-hidden="true" />
            </Button>
          )}
          {shareAction && (
            <Button
              variant="ghost"
              className="destination-share"
              disabled={busy || !shareAction.enabled}
              onClick={onShare}
            >
              {shareAction.label}
            </Button>
          )}
          <Button
            disabled={busy}
            variant="ghost"
            size="icon"
            className="destination-close"
            aria-label={
              searching
                ? "Close thread picker"
                : view.phase === "armed"
                  ? "Close controls; keep pending send"
                  : "Close controls; keep recording"
            }
            onClick={() => (searching ? collapse() : void act("dismiss"))}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        {searching && (
          <div className="destination-tray">
            <div
              id="destination-options"
              ref={list}
              className="destination-options"
              role="listbox"
              aria-label="Recording destination"
              onScroll={updateFade}
            >
              {choices.map((choice, row) => {
                const Icon = icons[choice.kind];
                const label = destinationLabels[choice.kind];
                const metadata = [
                  location(choice),
                  choice.kind === "new" || choice.kind === "pinned"
                    ? ""
                    : label,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <Button
                    key={choice.id}
                    id={"destination-option-" + row}
                    role="option"
                    disabled={busy}
                    tabIndex={-1}
                    variant="ghost"
                    className="destination-option"
                    aria-selected={choice.id === active?.id}
                    aria-label={[
                      choice.title,
                      choice.computer,
                      choice.project,
                      label,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    title={[choice.title, metadata].filter(Boolean).join(" · ")}
                    onClick={() => void act("choose", choice.id)}
                  >
                    <Icon aria-hidden="true" />
                    <span>
                      <span className="destination-option-title">
                        {choice.title}
                      </span>
                      <small>{metadata}</small>
                    </span>
                  </Button>
                );
              })}
            </div>
            {choices.length === 0 && (
              <p className="destination-empty" role="status">
                No matching threads. Try a different search.
              </p>
            )}
            {more && <div className="destination-fade" aria-hidden="true" />}
          </div>
        )}
      </div>
      {view.phase === "setup" ? (
        <div className="destination-notification">
          <StatusCard tone="neutral" headline="T3 isn’t connected" compact>
            <p>Connect in Settings → Labs.</p>
            <div className="destination-recovery">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void act("retry")}
              >
                Check connection
              </Button>
              <Button
                variant="outline"
                disabled={busy || view.processing}
                onClick={() => void act("copy")}
              >
                {copied ? "Copied" : "Copy instead"}
              </Button>
            </div>
          </StatusCard>
        </div>
      ) : failed ? (
        <div className="destination-notification">
          <StatusCard
            tone="failure"
            headline={
              view.phase === "uncertain"
                ? "Delivery not confirmed"
                : "Couldn’t submit"
            }
            compact
          >
            {view.confirmed && (
              <p className="destination-confirmed">
                <strong>{view.confirmed.title}</strong>
                <small>{location(view.confirmed)}</small>
              </p>
            )}
            {view.phase !== "uncertain" && (
              <p>{error || view.error || "Recording kept."}</p>
            )}
            {view.phase === "uncertain" && error && <p>{error}</p>}
            <div className="destination-recovery">
              <Button
                ref={retry}
                variant="outline"
                disabled={busy}
                onClick={() => void act("retry")}
              >
                {retrySame ? "Retry same send" : "Retry"}
              </Button>
              <Button
                variant="outline"
                disabled={busy || view.processing}
                onClick={() => void act("copy")}
              >
                <span role={copied ? "status" : undefined}>
                  {copied ? "Copied" : "Copy recording"}
                </span>
              </Button>
            </div>
          </StatusCard>
        </div>
      ) : view.phase === "armed" ? (
        <div
          className="destination-notification destination-receipt"
          role="status"
        >
          Preparing recording
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void act("cancel")}
          >
            Cancel send
          </Button>
        </div>
      ) : null}
    </div>
  );
}
