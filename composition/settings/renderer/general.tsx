import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button } from "@apparent/ui/button";
import { Switch } from "@apparent/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@apparent/ui/tooltip";
import { CircleAlert, RotateCcw } from "lucide-react";
import { ErrorDialog } from "@apparent/ui/error-dialog";
import {
  requestKey,
  requestName,
  failureKey,
  unconfirmedHelp,
  confirmationSummary,
  confirmed,
  type GeneralState,
  type Request,
  type Failure,
} from "./general-state";

declare global {
  interface Window {
    apparentSettingsShortcutInput?: {
      bindShortcutInput(
        root: HTMLDivElement,
        read: () => GeneralState | undefined,
        act: (action: Record<string, unknown>) => Promise<void>,
        invalid: (message: string) => void,
      ): () => void;
    };
  }
}
declare global {
  interface Window {
    apparentGeneral?: {
      read(): Promise<GeneralState | undefined>;
      act(action: unknown): Promise<void>;
      subscribe(callback: (state: GeneralState) => void): () => void;
    };
  }
}

export function General({ connect }: { connect: ReactNode }) {
  const [state, setState] = useState<GeneralState>(),
    [validation, setValidation] = useState("");
  const [failures, setFailures] = useState<Failure[]>([]),
    [pending, setPending] = useState<string[]>([]),
    [uncertain, setUncertain] = useState<Request[]>([]);
  const failure = failures[0] ?? null;
  function fail(next: Failure) {
    setFailures((list) =>
      list.some((f) => failureKey(f) === failureKey(next))
        ? list
        : [...list, next],
    );
  }
  const requests = useRef(new Map<string, Request>()),
    latest = useRef<GeneralState | undefined>(undefined),
    alive = useRef(true),
    restore = useRef<HTMLElement | null>(null),
    fallback = useRef<HTMLElement | null>(null);
  const generalRoot = useRef<HTMLDivElement>(null);
  const validationKey = state?.shortcuts
    .map((s) => s.error || (s.recording ? validation : ""))
    .join("\0");
  const uncertaintyKey = uncertain
    .map((r) => requestKey(r.action, r.before))
    .join(",");
  useLayoutEffect(() => {
    if (
      !pending.length &&
      !failure &&
      document.activeElement === document.body &&
      document.hasFocus()
    )
      restoreFocus();
    if ((!validationKey && !uncertaintyKey) || failure) return;
    for (const alert of generalRoot.current?.querySelectorAll<HTMLElement>(
      ".general-validation,.general-uncertain",
    ) ?? []) {
      const row = alert.closest<HTMLElement>(
        ".general-shortcut,.general-control-region",
      );
      if (
        row &&
        (row.contains(document.activeElement) ||
          (document.activeElement === document.body &&
            row.contains(restore.current)))
      ) {
        row.scrollIntoView({ block: "nearest", inline: "nearest" });
        break;
      }
    }
  }, [validationKey, uncertaintyKey, !!failure, pending]);
  function restoreFocus() {
    const target = restore.current?.isConnected
      ? restore.current
      : fallback.current;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }
  function rememberFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !active.closest("dialog")) {
      restore.current = active;
      fallback.current =
        active
          .closest(".general-shortcut")
          ?.querySelector<HTMLElement>("button") ?? active;
    }
  }
  function finish(key: string) {
    const request = requests.current.get(key);
    if (request) clearTimeout(request.timer);
    requests.current.delete(key);
    if (alive.current) setPending([...requests.current.keys()]);
  }
  function receive(next: GeneralState) {
    latest.current = next;
    setState(next);
    const settled = new Set<string>();
    for (const [key, request] of requests.current)
      if (confirmed(next, request)) {
        settled.add(key);
        finish(key);
      }
    setUncertain((list) =>
      list.filter(
        (r) =>
          !settled.has(requestKey(r.action, r.before)) && !confirmed(next, r),
      ),
    );
    setFailures((list) =>
      list.filter(
        (f) =>
          f.kind !== "read" &&
          !(f.kind === "change" && confirmed(next, f.request)),
      ),
    );
  }
  async function read() {
    try {
      const next = await window.apparentGeneral?.read();
      if (!next) throw new Error("No General state");
      if (alive.current) receive(next);
    } catch {
      if (alive.current)
        fail({
          kind: "read",
          message: "General settings could not be read.",
          retry: () => void read(),
        });
    }
  }
  function subscribeGeneral() {
    let active = true,
      received = false;
    alive.current = true;
    const bridge = window.apparentGeneral;
    const startupTimer = setTimeout(() => {
      if (active && !latest.current)
        fail({
          kind: "read",
          message: "General settings have not arrived yet.",
          retry: () => void read(),
        });
    }, 8000);
    const unsubscribe = bridge?.subscribe((next) => {
      received = true;
      receive(next);
    });
    void bridge
      ?.read()
      .then((next) => {
        if (active && !received && next) receive(next);
      })
      .catch(() => {
        if (active)
          fail({
            kind: "read",
            message: "General settings could not be read.",
            retry: () => void read(),
          });
      });
    return () => {
      active = false;
      alive.current = false;
      clearTimeout(startupTimer);
      unsubscribe?.();
      for (const r of requests.current.values()) clearTimeout(r.timer);
      requests.current.clear();
    };
  }
  async function act(
    action: Record<string, unknown>,
    prepare?: Record<string, unknown>,
  ) {
    const before = latest.current;
    if (!before) return;
    const key = requestKey(action, before);
    if (requests.current.has(key)) return;
    rememberFocus();
    setValidation("");
    setFailures((list) =>
      list.filter((f) => failureKey(f) !== `change:${key}`),
    );
    const retry = () => void act(action, prepare);
    const request: Request = {
      action,
      prepare,
      before,
      timer: setTimeout(() => {
        if (requests.current.get(key) !== request) return;
        finish(key);
        if (alive.current) {
          setUncertain((list) => [
            ...list.filter((r) => requestKey(r.action, r.before) !== key),
            request,
          ]);
          fail({
            kind: "change",
            request,
            unconfirmed: true,
            message:
              action.action === "set"
                ? confirmationSummary(request)
                : unconfirmedHelp(action),
            retry,
          });
        }
      }, 8000),
    };
    requests.current.set(key, request);
    setPending([...requests.current.keys()]);
    try {
      const bridge = window.apparentGeneral;
      if (!bridge) throw new Error("No General bridge");
      if (prepare) await bridge.act(prepare);
      await bridge.act(action);
      if (requests.current.get(key) !== request) return;
      if (latest.current && confirmed(latest.current, request)) finish(key);
    } catch {
      if (requests.current.get(key) !== request) return;
      finish(key);
      if (alive.current)
        fail({
          kind: "change",
          request,
          unconfirmed: false,
          message: "Reopen Settings if this keeps happening.",
          retry,
        });
    }
  }
  const mount = useCallback((root: HTMLDivElement | null) => {
    if (!root) return;
    generalRoot.current = root;
    const unsubscribe = subscribeGeneral();
    const unbind = window.apparentSettingsShortcutInput?.bindShortcutInput(
      root,
      () => latest.current,
      act,
      setValidation,
    );
    return () => {
      unbind?.();
      unsubscribe();
      generalRoot.current = null;
    };
  }, []);
  function uncertaintyDescription(key: string, description?: string) {
    return (
      [
        !pending.includes(key) &&
        uncertain.some((r) => requestKey(r.action, r.before) === key)
          ? `uncertain-${key}`
          : undefined,
        description,
      ]
        .filter(Boolean)
        .join(" ") || undefined
    );
  }
  function uncertainNote(key: string) {
    const request = uncertain.find(
      (r) => requestKey(r.action, r.before) === key,
    );
    return (
      request &&
      !pending.includes(key) && (
        <div className="general-uncertain">
          <p id={`uncertain-${key}`} role="status">
            <CircleAlert aria-hidden="true" />
            <span>
              Change not confirmed. {confirmationSummary(request)} Reopen
              Settings to check.
            </span>
          </p>
          <Button
            variant="link"
            className="general-shortcut-utility"
            aria-label={`Retry ${requestName(request).toLowerCase()} change`}
            onClick={() => void act(request.action, request.prepare)}
          >
            Try again
          </Button>
        </div>
      )
    );
  }
  function toggle(
    label: string,
    key: string,
    on: boolean,
    available = true,
    description?: string,
    note?: string,
  ) {
    return (
      <div className="general-setting">
        <div className="general-control-region">
          <div className="general-row">
            <label id={`general-${key}-label`} htmlFor={`general-${key}`}>
              {label}
            </label>
            <Switch
              id={`general-${key}`}
              aria-labelledby={`general-${key}-label`}
              aria-describedby={uncertaintyDescription(key, description)}
              aria-busy={pending.includes(key) || undefined}
              checked={on}
              disabled={!available || pending.includes(key)}
              onCheckedChange={(value) =>
                void act({ action: "set", key, value })
              }
            />
          </div>
          {uncertainNote(key)}
        </div>
        {note && (
          <p id={description} className="general-setting-note">
            {note}
          </p>
        )}
      </div>
    );
  }
  return (
    <div ref={mount} className="general-settings">
      {connect}
      <span role="status" className="sr-only">
        {pending.length ? "Waiting for Apparent to confirm the change." : ""}
      </span>
      <ErrorDialog
        key={failure ? failureKey(failure) : "closed"}
        open={!!failure}
        title={
          failure?.kind === "read"
            ? "General settings unavailable"
            : failure?.kind === "change"
              ? failure.unconfirmed
                ? `${requestName(failure.request)} not confirmed`
                : `Couldn’t change ${requestName(failure.request).toLowerCase()}`
              : ""
        }
        description={failure?.message ?? ""}
        recoveryLabel="Try again"
        onRecover={() => failure?.retry()}
        onClose={() => setFailures((list) => list.slice(1))}
        restoreFocus={restoreFocus}
      />
      {!state ? (
        <p className="general-section" role="status">
          Reading General settings…
        </p>
      ) : (
        <>
          <div className="general-section">
            {toggle(
              "Launch at login",
              "launchAtLogin",
              state.login.on,
              state.login.available,
              state.login.needsApproval || !state.login.available
                ? "general-login-detail"
                : undefined,
            )}
            {state.login.needsApproval && (
              <div id="general-login-detail" className="general-guidance">
                <p>Allow Apparent in Login Items in System Settings.</p>
                <Button
                  variant="link"
                  disabled={pending.includes("launchAtLogin")}
                  onClick={() =>
                    void act({
                      action: "set",
                      key: "launchAtLogin",
                      value: true,
                    })
                  }
                >
                  Open Login Items
                </Button>
              </div>
            )}
            {!state.login.available && (
              <p id="general-login-detail" className="settings-metadata">
                Launch at login requires an installed app.
              </p>
            )}
          </div>
          <div className="general-section">
            {toggle(
              "Send technical error reports",
              "errorReporting",
              state.errorReporting,
              true,
              "general-reporting-detail",
              "Reports include failure details, app version and operating system. No recordings, screenshots, transcripts or clipboard contents are sent.",
            )}
          </div>

          <section
            className="general-section"
            aria-labelledby="general-shortcuts"
          >
            <h2 id="general-shortcuts" tabIndex={-1}>
              Keyboard shortcuts
            </h2>
            {state.shortcuts.map((s) => {
              const fn = s.suggestedFn;
              const message = s.error || (s.recording ? validation : "");
              return (
                <div
                  key={s.kind}
                  className="general-shortcut"
                  role="group"
                  aria-labelledby={`shortcut-${s.kind}`}
                >
                  <div className="general-shortcut-row">
                    <span id={`shortcut-${s.kind}`}>{s.title}</span>
                    <div className="settings-actions">
                      <Button
                        variant="outline"
                        className="general-shortcut-control"
                        aria-label={
                          s.recording
                            ? `Cancel changing ${s.title} shortcut`
                            : `Change ${s.title} shortcut${s.label ? `, currently ${s.label}` : ""}`
                        }
                        aria-invalid={message ? true : undefined}
                        aria-describedby={uncertaintyDescription(
                          s.kind,
                          message || s.externallyManaged
                            ? `shortcut-${s.kind}-detail`
                            : undefined,
                        )}
                        aria-busy={pending.includes(s.kind) || undefined}
                        disabled={
                          s.externallyManaged || pending.includes(s.kind)
                        }
                        onClick={() =>
                          void act({
                            action: s.recording
                              ? "cancel-shortcut"
                              : "record-shortcut",
                            ...(s.recording ? {} : { kind: s.kind }),
                          })
                        }
                      >
                        {s.recording
                          ? "Press shortcut… (Esc cancels)"
                          : s.label || "Set shortcut"}
                      </Button>
                      {!s.isDefault && !s.recording && !s.externallyManaged && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                className="general-reset"
                                variant="ghost"
                                disabled={pending.includes(s.kind)}
                                aria-busy={
                                  pending.includes(s.kind) || undefined
                                }
                                aria-label={`Reset ${s.title} shortcut`}
                                onClick={() =>
                                  void act({
                                    action: "reset-shortcut",
                                    kind: s.kind,
                                  })
                                }
                              >
                                <RotateCcw aria-hidden="true" size={16} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="settings-help-content">
                              Reset shortcut
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {s.clearable &&
                        s.label &&
                        !s.recording &&
                        !s.externallyManaged && (
                          <Button
                            variant="link"
                            className="general-shortcut-utility"
                            aria-label={`Turn off ${s.title} shortcut`}
                            disabled={pending.includes(s.kind)}
                            aria-busy={pending.includes(s.kind) || undefined}
                            onClick={() =>
                              void act({
                                action: "clear-shortcut",
                                kind: s.kind,
                              })
                            }
                          >
                            Turn off
                          </Button>
                        )}
                      {fn &&
                        s.kind === "record" &&
                        (s.recording || s.label !== fn.key) && (
                          <Button
                            data-shortcut-suggestion="fn"
                            variant="link"
                            className="general-shortcut-utility"
                            disabled={pending.includes(s.kind)}
                            aria-busy={pending.includes(s.kind) || undefined}
                            onClick={() =>
                              void act(
                                {
                                  action: "shortcut",
                                  kind: s.kind,
                                  ...fn,
                                  reserved: false,
                                },
                                s.recording
                                  ? undefined
                                  : { action: "record-shortcut", kind: s.kind },
                              )
                            }
                          >
                            Use Fn
                          </Button>
                        )}
                    </div>
                  </div>
                  {(message || s.externallyManaged) && (
                    <p
                      id={`shortcut-${s.kind}-detail`}
                      className={`settings-metadata${message ? " general-validation" : ""}`}
                      role={message ? "alert" : undefined}
                    >
                      {message && <CircleAlert aria-hidden="true" />}
                      <span>
                        {message ||
                          "Managed by your desktop’s shortcut settings."}
                      </span>
                    </p>
                  )}
                  {uncertainNote(s.kind)}
                </div>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
