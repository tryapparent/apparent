import { createPortal } from "react-dom";
import { useId, useRef } from "react";
import { Button } from "@apparent/ui/button";
import { StatusCard } from "@apparent/ui/status-card";
import { DisclosureMenu } from "@apparent/ui/disclosure-menu";
import "@apparent/ui/status.css";
import "./card.css";
import frogs from "../../shared/assets/brand/connect-frogs.png";
import type { useConnectFlow } from "./flow";
import {
  connectPresentation,
  connectActionRole,
  uploadDisclosure,
  activityDisclosure,
} from "./presentation";

export { useConnectFlow } from "./flow";

function closeDisclosure(event: React.KeyboardEvent<HTMLDetailsElement>) {
  if (event.key === "Escape" && event.currentTarget.open) {
    event.currentTarget.open = false;
    event.currentTarget.querySelector("summary")?.focus();
    event.stopPropagation();
  }
}

export function ConnectCard({
  flow,
}: {
  flow: ReturnType<typeof useConnectFlow>;
}) {
  const { result, busy, request, browserFailed } = flow;
  const activity = useRef<HTMLDialogElement>(null);
  const activityTitle = useId();

  if (result.status === "disabled") return null;
  const view = result.status === "connected" ? result.view : undefined;
  const { presentation: p, step } = connectPresentation(view);
  const buttons = p?.buttons ?? view?.buttons ?? [];
  const menu = new Set(p?.menuActions ?? []);
  const controls = buttons.filter((button) => menu.has(button.command));
  const cardButtons = buttons.filter(
    (button) => !menu.has(button.command) && button.command !== "open-browser",
  );
  const browserButton = buttons.find(
    (button) => button.command === "open-browser",
  );
  const actions =
    browserFailed && browserButton
      ? [browserButton, ...cardButtons]
      : cardButtons;
  const waiting =
    p?.tone === "progress" &&
    !browserFailed &&
    actions.length === 1 &&
    actions[0].command === "cancel";
  function renderButton(button: (typeof buttons)[number], close?: () => void) {
    return (
      <Button
        key={button.command}
        variant="ghost"
        className={
          close
            ? undefined
            : connectActionRole(
                button.command,
                p?.tone,
                buttons.map((b) => b.command),
              )
        }
        disabled={busy || !button.enabled}
        onClick={() => {
          close?.();
          void request(button.command);
        }}
      >
        {button.title}
      </Button>
    );
  }
  const account = p?.accountMenu && (
    <DisclosureMenu label="Connect account" trigger="Connect account">
      {(close) => (
        <>
          <p className="menu-context">
            This computer
            {view?.server && (
              <>
                <br />
                {view.server}
              </>
            )}
          </p>
          {controls.map((button) => renderButton(button, close))}
          <Button
            variant="ghost"
            aria-haspopup="dialog"
            onClick={() => {
              close();
              const dialog = activity.current;
              dialog?.showModal();
              dialog?.querySelector("h2")?.focus();
            }}
          >
            Activity counts
          </Button>
        </>
      )}
    </DisclosureMenu>
  );
  const accountSlot = document.getElementById("settings-account");
  return (
    <section
      aria-label="Apparent Connect"
      className="apparent-connect-workflow"
      data-waiting={waiting || undefined}
      data-layout={
        p?.artwork ? (p.compact ? "connected" : "invitation") : "status"
      }
    >
      {account &&
        (accountSlot ? (
          createPortal(account, accountSlot)
        ) : (
          <div className="flex justify-end pb-4">{account}</div>
        ))}
      {account && (
        <dialog
          className="connect-activity-dialog"
          aria-labelledby={activityTitle}
          aria-describedby={`${activityTitle}-detail`}
          ref={activity}
        >
          <h2 id={activityTitle} tabIndex={-1}>
            Activity counts
          </h2>
          <p id={`${activityTitle}-detail`}>{activityDisclosure}</p>
          <Button variant="outline" onClick={() => activity.current?.close()}>
            Close
          </Button>
        </dialog>
      )}

      <StatusCard
        tone={p?.tone ?? (view ? "neutral" : busy ? "progress" : "failure")}
        headline={
          p?.headline ??
          view?.status ??
          (busy ? "Reading connection settings…" : "Connection unavailable.")
        }
        leading={
          step !== null && (
            <ol className="connect-progress" aria-label="Connect setup">
              {["Connect", "Approve"].map((label, index) => (
                <li
                  key={label}
                  aria-current={step === index + 1 ? "step" : undefined}
                >
                  {index + 1} · {label}
                </li>
              ))}
            </ol>
          )
        }
        footer={
          actions.length > 0 && (
            <>
              {browserFailed && browserButton && (
                <p className="connect-browser-error" role="alert">
                  The browser could not be opened. Try again, or cancel to keep
                  captures local.
                </p>
              )}
              <div className="status-actions">
                {actions.map((button) => renderButton(button))}
                {buttons.some((b) => b.command === "connect") &&
                  p?.tone !== "failure" && (
                    <details
                      className="connect-info"
                      onKeyDown={closeDisclosure}
                    >
                      <summary>Privacy</summary>
                      <p>{uploadDisclosure(view?.encryption)}</p>
                      <p>{activityDisclosure}</p>
                    </details>
                  )}
                {p?.tone === "failure" && p.step === undefined && (
                  <details className="connect-info" onKeyDown={closeDisclosure}>
                    <summary>Details</summary>
                    <p>{p.detail}</p>
                  </details>
                )}
              </div>
            </>
          )
        }
        compact={p?.compact}
        artwork={p?.artwork ? <img src={frogs} alt="" /> : undefined}
      >
        {(p?.step !== undefined || p?.tone !== "failure") &&
          (p?.detail ?? view?.detail) && <p>{p?.detail ?? view?.detail}</p>}
        {p?.note && <p className="status-note">{p.note}</p>}

        {(!view || p?.refresh) && (
          <Button
            className="primary-action"
            disabled={busy}
            onClick={() => void request("refresh")}
          >
            Refresh connection
          </Button>
        )}
      </StatusCard>
    </section>
  );
}
