import { useCallback, useRef, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  LoaderCircle,
  RotateCw,
  Star,
} from "lucide-react";
import { Button } from "@apparent/ui/button";
import { ErrorDialog } from "@apparent/ui/error-dialog";
import { NativeSelect, NativeSelectOption } from "@apparent/ui/native-select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@apparent/ui/tooltip";
import macUpdates from "../about/mac-updates.mjs";
import updateAction from "../about/release-action.mjs";
import "./about.css";

type UpdateProgress =
  | { phase: "downloading"; downloadedBytes: number; totalBytes: number }
  | { phase: "verifying" | "installing" };

const updateFailures = {
  busy: [
    "Update in progress",
    "Another update is running. Try again in a moment.",
  ],
  rateLimited: [
    "GitHub limited update checks",
    "Wait a while, then try again.",
  ],
  download: [
    "Download failed",
    "Check your connection and free disk space, then retry the update.",
    "Retry update",
  ],
  verification: [
    "Couldn’t verify the download",
    "Retry the update to start with a fresh release check.",
    "Retry update",
  ],
  installation: [
    "Couldn’t install the update",
    "Check that your AppImage folder is writable and has free space, then retry the update.",
    "Retry update",
  ],
  restart: [
    "Couldn’t restart Apparent",
    "The update is still installed. After closing, use Restart now in About.",
    "Retry restart",
  ],
} as const;

export interface AboutState {
  version: string;
  updates: boolean;
  linux: boolean;
  mainUpdates: boolean;
  mac?: boolean;
  nightly?: boolean;
  updateChannel: string;
  restartPending?: boolean;
  resumeTour?: boolean;
  updateCheck: {
    checking: boolean;
    result: "available" | "current" | "failed" | null;
    progress?: UpdateProgress;
    failure?: keyof typeof updateFailures;
  };
}
type Action = { action: string; key?: string; value?: string };
export interface AboutBridge {
  read(): Promise<AboutState | undefined>;
  act(action: Action): Promise<void>;
  subscribe(callback: (state: AboutState) => void): () => void;
  link(link: "website" | "source" | "discord" | "nightly"): Promise<void>;
  copyVersion(): Promise<void>;
}
type AboutArtwork = { available: string; current: string; failed: string };

export function About({
  bridge,
  artwork,
}: {
  bridge: AboutBridge;
  artwork: AboutArtwork;
}) {
  const [state, setState] = useState<AboutState>();
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const pane = useRef<HTMLElement | null>(null);
  const primaryAction = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const connect = useCallback(
    (section: HTMLElement | null) => {
      if (!section) return;
      pane.current = section;
      let live = true;
      let received = false;
      const unsubscribe = bridge.subscribe((value) => {
        received = true;
        if (live) setState(value);
      });
      void bridge
        .read()
        .then((value) => {
          if (live && !received && value) setState(value);
        })
        .catch(() => {
          if (live)
            setError(
              "Unable to read update status. Reopen Settings to try again.",
            );
        });
      return () => {
        live = false;
        pane.current = null;
        unsubscribe();
        clearTimeout(copyTimer.current);
      };
    },
    [bridge],
  );
  async function copyVersion() {
    const section = pane.current;
    if (!state || !section) return;
    try {
      await bridge.copyVersion();
      if (pane.current !== section) return;
      setCopyStatus("copied");
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopyStatus("idle"), 2500);
    } catch {
      if (pane.current !== section) return;
      clearTimeout(copyTimer.current);
      setCopyStatus("failed");
    }
  }
  const act = useCallback(
    async (action: Action) => {
      setError("");
      try {
        await bridge.act(action);
      } catch {
        setError("Unable to complete that action. Please try again.");
      }
    },
    [bridge],
  );
  async function changeChannel(channel: string) {
    setError("");
    try {
      await bridge.act({ action: "set", key: "updateChannel", value: channel });
    } catch {
      setError("Unable to change the update channel. Please try again.");
    }
  }
  async function open(link: "website" | "source" | "discord" | "nightly") {
    setError("");
    try {
      await bridge.link(link);
    } catch {
      setError(
        link === "nightly"
          ? "Nightly download unavailable. Try again later."
          : "Unable to open that link. Please try again.",
      );
    }
  }
  const result = state?.updateCheck.result;
  const checking = state?.updateCheck.checking;
  const failure = state?.updateCheck.failure;
  const restart = updateAction.show_restart(
    state?.restartPending === true,
    checking === true,
  );
  const restartOffer = updateAction.show_restart_later(
    restart,
    result === "available",
  );
  const failedRestart = result === "failed" && failure === "restart";
  const showFailure = updateAction.show_failure(
    result === "failed" && !checking,
    failedRestart,
    restart,
  );
  const showUnstagedRestartFailure = updateAction.show_unstaged_restart_failure(
    failedRestart && !checking,
    restart,
  );
  const installWarning =
    state?.linux && state.updates && !checking && !restart;
  const progress = checking ? state?.updateCheck.progress : undefined;
  const downloading = progress?.phase === "downloading";
  const percent =
    downloading &&
    progress.totalBytes > 0 &&
    progress.downloadedBytes <= progress.totalBytes
      ? Math.floor((100 * progress.downloadedBytes) / progress.totalBytes)
      : undefined;
  const [failureTitle, failureDescription, failureRecovery] = failure
    ? updateFailures[failure]
    : ["Update check failed", "Your current version is still running."];
  const title = checking
    ? downloading
      ? "Downloading update…"
      : progress?.phase === "verifying"
        ? "Verifying download…"
        : progress?.phase === "installing"
          ? "Installing update…"
          : "Checking for updates…"
    : !state?.updates
      ? "Updates unavailable"
      : restart
        ? "Restart required"
        : result === "current"
          ? "No update available"
          : null;
  const listenForDismissal = useCallback(
    (section: HTMLElement | null) => {
      if (
        !section ||
        (!restartOffer && result !== "current") ||
        copyStatus === "failed"
      )
        return;
      const listener = (event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented)
          void act({ action: "dismiss-update-check" });
      };
      window.addEventListener("keydown", listener);
      return () => window.removeEventListener("keydown", listener);
    },
    [restartOffer, result, copyStatus, act],
  );
  return (
    <section
      ref={connect}
      aria-label="About Apparent"
      className="settings-about"
    >
      {!state && <p role="status">Loading update status…</p>}
      {error && <p role="alert">{error}</p>}
      {state && (
        <>
          <section className="settings-identity" aria-label="Build identity">
            <h2>{state.nightly ? "apparent Nightly" : "apparent"}</h2>
            <div className="settings-version">
              <span className="select-text">Version {state.version}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="settings-copy"
                      aria-label="Copy version"
                      onClick={() => void copyVersion()}
                    >
                      {copyStatus === "copied" ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <Copy aria-hidden="true" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="settings-help-content">
                    Copy version
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span role="status" className="settings-metadata">
                {copyStatus === "copied" ? "Copied" : ""}
              </span>
            </div>
          </section>
          <section
            ref={listenForDismissal}
            className="settings-updates"
            aria-label="App updates"
            data-idle={!title || undefined}
            data-busy={checking || undefined}
          >
            {state.linux && state.mainUpdates && state.updates && (
              <div className="settings-channel-group">
                <div className="settings-channel">
                  <label htmlFor="update-channel">Release channel</label>
                  <NativeSelect
                    id="update-channel"
                    aria-describedby="update-channel-description"
                    value={state.updateChannel}
                    disabled={checking}
                    onChange={(event) => void changeChannel(event.target.value)}
                  >
                    <NativeSelectOption value="stable">
                      Stable releases
                    </NativeSelectOption>
                    <NativeSelectOption value="main">
                      Development builds
                    </NativeSelectOption>
                  </NativeSelect>
                </div>
                <p id="update-channel-description" className="settings-metadata">
                  Source for the next install. Stable is for everyday use.
                  Development gets changes sooner and may be less reliable.
                </p>
              </div>
            )}
            <div className="settings-update-flow">
              <div className="settings-update-text">
                <div className="settings-update-phase">
                  <div
                    className="settings-result"
                    role="status"
                    aria-atomic="true"
                  >
                    {title && (
                      <>
                        {checking && !downloading ? (
                          <LoaderCircle
                            className="settings-spin"
                            aria-hidden="true"
                          />
                        ) : restart ? (
                          <RotateCw aria-hidden="true" />
                        ) : (
                          result && (
                            <CheckCircle2
                              className="text-success"
                              aria-hidden="true"
                            />
                          )
                        )}
                        <h3>{title}</h3>
                      </>
                    )}
                  </div>
                  {percent !== undefined && (
                    <span
                      aria-hidden="true"
                      className="settings-update-percent settings-metadata"
                    >
                      {percent}%
                    </span>
                  )}
                </div>
                {downloading && (
                  <progress
                    className="settings-update-progress"
                    aria-label="Update download"
                    max={100}
                    value={percent}
                  />
                )}
                {!state.updates && (
                  <p className="settings-metadata">
                    {state.linux
                      ? "To install updates here, run Apparent from an AppImage."
                      : "Updates work in the installed Apparent.app."}
                  </p>
                )}
                {showUnstagedRestartFailure && (
                  <p className="settings-update-note" role="alert">
                    Apparent couldn’t restart. A staged update couldn’t be confirmed.
                  </p>
                )}
                {installWarning && (
                  <p id="update-channel-hint" className="settings-update-note">
                    Installing can replace your current version with an earlier one.
                  </p>
                )}
                {restart && (
                  <p className="settings-update-note">
                    An update is installed. Restart Apparent to use it.
                  </p>
                )}
                {!checking && (
                  <div className="settings-actions">
                    {restart ? (
                      <>
                        <Button
                          ref={primaryAction}
                          onClick={() => void act({ action: "update-now" })}
                        >
                          Restart now
                        </Button>
                        {restartOffer && (
                          <Button
                            variant="outline"
                            className="settings-decision-alternative"
                            onClick={() => {
                              primaryAction.current?.focus();
                              void act({ action: "update-later" });
                            }}
                          >
                            Restart later
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        ref={primaryAction}
                        disabled={!state.updates}
                        aria-describedby={
                          installWarning ? "update-channel-hint" : undefined
                        }
                        onClick={() =>
                          void act({ action: "check-for-updates" })
                        }
                      >
                        {result === "current" && !state.linux
                            ? "Check again"
                            : updateAction.release_action(state.linux)}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {(restart || (!checking && result === "current")) && (
                <img
                  className="settings-frog"
                  src={restart ? artwork.available : artwork.current}
                  alt=""
                />
              )}
            </div>
            {macUpdates.show_nightly_download(
              state.mac === true,
              state.nightly === true,
            ) && (
              <Button
                variant="link"
                className="settings-nightly-download"
                disabled={checking}
                onClick={() => void open("nightly")}
              >
                Download Nightly <ExternalLink aria-hidden="true" />
              </Button>
            )}
          </section>
        </>
      )}
      <section className="settings-support" aria-label="Support apparent">
        <Button variant="link" asChild>
          <a
            href="https://github.com/tryapparent/apparent"
            onClick={(event) => {
              event.preventDefault();
              void open("source");
            }}
          >
            <Star aria-hidden="true" />
            Star on GitHub <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <p className="settings-metadata">
          A GitHub star won’t fix your bugs, but it will make our day.
        </p>
      </section>
      <div className="settings-links">
        <Button variant="link" asChild>
          <a
            href="https://app.tryapparent.com"
            onClick={(event) => {
              event.preventDefault();
              void open("website");
            }}
          >
            Website <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <Button variant="link" asChild>
          <a
            href="https://github.com/tryapparent/apparent"
            onClick={(event) => {
              event.preventDefault();
              void open("source");
            }}
          >
            Source code <ExternalLink aria-hidden="true" />
          </a>
        </Button>
        <Button variant="link" asChild>
          <a
            href="https://discord.gg/ZRGZwV32M"
            onClick={(event) => {
              event.preventDefault();
              void open("discord");
            }}
          >
            Join our Discord <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      </div>
      <Button
        variant="secondary"
        className="settings-tour"
        onClick={() => void act({ action: "tour" })}
      >
        {state?.resumeTour ? "Resume setup" : "Show welcome tour"}
      </Button>
      <ErrorDialog
        open={showFailure}
        title={failureTitle}
        description={failureDescription}
        artwork={<img src={artwork.failed} alt="" />}
        recoveryLabel={failureRecovery ?? "Try again"}
        onRecover={() =>
          void act({
            action: failure === "restart" ? "update-now" : "check-for-updates",
          })
        }
        restoreFocus={() => primaryAction.current?.focus()}
        onClose={() => void act({ action: "dismiss-update-check" })}
      />
      <ErrorDialog
        open={copyStatus === "failed"}
        title="Unable to copy version"
        description="Unable to copy. Try again."
        artwork={<img src={artwork.failed} alt="" />}
        recoveryLabel="Try again"
        onRecover={() => void copyVersion()}
        onClose={() => setCopyStatus("idle")}
      />
    </section>
  );
}
