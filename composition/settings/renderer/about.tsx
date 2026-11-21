import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@apparent/ui/tooltip";
import macUpdates from "../about/mac-updates.mjs";
import updateAction from "../about/release-action.mjs";
import { UpdateChannel } from "./update-channel";
import { UpdatePond } from "./update-pond";
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
    "After closing, use Restart now in About.",
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
  stagedRelease?: { channel: string; id: string } | null;
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
  headingActions,
}: {
  bridge: AboutBridge;
  artwork: AboutArtwork;
  headingActions: HTMLElement | null;
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
  const showReleaseAction = updateAction.show_release_action(
    state?.linux === true,
    result === "current",
  );
  const installWarning =
    state?.linux && state.updates && !checking && !restart && showReleaseAction;
  const progress = checking ? state?.updateCheck.progress : undefined;
  const downloading = progress?.phase === "downloading";
  const showPond = state?.linux && state.updates;
  const percent =
    downloading &&
    progress.totalBytes > 0 &&
    progress.downloadedBytes <= progress.totalBytes
      ? Math.floor((100 * progress.downloadedBytes) / progress.totalBytes)
      : undefined;
  const [failureTitle, failureDescription, failureRecovery] = failure
    ? updateFailures[failure]
    : ["Update check failed", "Your current version is still running."];
  const restartTarget = updateAction.staged_release_note(
    state?.stagedRelease?.channel ?? "",
    state?.stagedRelease?.id ?? "",
  );
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
        (!restartOffer && !(result === "current" && showReleaseAction)) ||
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
    [restartOffer, result, showReleaseAction, copyStatus, act],
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
            {state.nightly && <h2>apparent Nightly</h2>}
            <div className="settings-version">
              <span className="select-text">Running version {state.version}</span>
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
            <div
              className="settings-update-flow"
              data-pond={showPond || undefined}
            >
              {showPond && (
                <UpdatePond
                  scene={
                    checking
                      ? downloading
                        ? "folding"
                        : progress
                          ? "finishing"
                          : "checking"
                      : restart
                        ? "ready"
                        : result === "current"
                          ? "current"
                          : "idle"
                  }
                />
              )}
              {showPond && state.mainUpdates && (
                <UpdateChannel
                  value={state.updateChannel}
                  disabled={checking === true}
                  onChange={(value) => void changeChannel(value)}
                />
              )}
              <div className="settings-update-text">
                <div
                  className={restart && showPond ? "sr-only" : "settings-result"}
                  role="status"
                  aria-atomic="true"
                >
                  {restart && showPond ? title : title && (
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
                {downloading && (
                  <div className="settings-update-transfer">
                    <progress
                      className="settings-update-progress"
                      aria-label="Update download"
                      max={100}
                      value={percent}
                    />
                    {percent !== undefined && (
                      <span
                        aria-hidden="true"
                        className="settings-update-percent settings-metadata"
                      >
                        {percent}%
                      </span>
                    )}
                  </div>
                )}
                {!state.updates && (
                  <p className="settings-metadata">
                    {state.linux
                      ? "To install updates here, run Apparent from an AppImage."
                      : "Updates work in the installed Apparent.app."}
                  </p>
                )}
                {showUnstagedRestartFailure && (
                  <p
                    id="restart-unconfirmed"
                    className="settings-update-note"
                    role="alert"
                  >
                    Apparent couldn’t confirm an installed update.
                    {installWarning &&
                      " To try again, install from the selected channel."}
                  </p>
                )}
                {installWarning && (
                  <p id="update-channel-hint" className="settings-update-note">
                    May install an earlier version.
                  </p>
                )}
                {restart && (
                  <p id="staged-release" className="settings-update-note" hidden={showPond || undefined}>
                    {restartTarget}
                  </p>
                )}
                {!checking && (restart || showReleaseAction) && (
                  <div className="settings-actions">
                    {restart ? (
                      <>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="settings-restart-trigger">
                                <Button
                                  ref={primaryAction}
                                  aria-describedby="staged-release"
                                  onClick={() => void act({ action: "update-now" })}
                                >
                                  Restart now
                                </Button>
                              </span>
                            </TooltipTrigger>
                            {showPond && (
                              <TooltipContent className="settings-help-content" side="left" align="start">
                                {restartTarget}
                              </TooltipContent>
                            )}
                          </Tooltip>
                        </TooltipProvider>
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
                          installWarning
                            ? showUnstagedRestartFailure
                              ? "restart-unconfirmed update-channel-hint"
                              : "update-channel-hint"
                            : undefined
                        }
                        onClick={() =>
                          void act({ action: "check-for-updates" })
                        }
                      >
                        {result === "current" && !state.linux
                            ? "Check again"
                            : updateAction.release_action(
                                state.linux,
                                state.updateChannel,
                              )}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {!showPond && (restart || (!checking && result === "current")) && (
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
      {headingActions && createPortal(
        <Button variant="secondary" onClick={() => void act({ action: "tour" })}>
          {state?.resumeTour ? "Resume setup" : "Show welcome tour"}
        </Button>,
        headingActions,
      )}
      <ErrorDialog
        open={showFailure}
        title={failureTitle}
        description={
          failedRestart
            ? `${restartTarget} ${failureDescription}`
            : failureDescription
        }
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
