import type { ConnectView } from "../client/typescript/src/account/protocol.ts";

export const activityDisclosure =
  "Starting a recording while connected counts your account as active in daily and weekly totals. Practice recordings are excluded. Apparent keeps a pseudonymous account ID and the last active date (UTC) for seven days. The counts use no recording content or email addresses. Manage this in your Connect account’s analytics settings.";

export function connectPresentation(view: ConnectView | undefined) {
  const original = view?.presentation;
  if (!original) return { presentation: original, step: null };
  if (original.step !== undefined)
    return { presentation: original, step: original.step };
  const presentation = {
    ...original,
    buttons: original.buttons.map((b) => ({ ...b })),
    note: "",
    compact: true,
  };
  const commands = new Set(original.buttons.map((button) => button.command));
  let step: number | null = null;
  const encrypted = view?.encryption === true;
  const mode = encrypted
    ? "End-to-end encrypted."
    : view?.encryption === false
      ? "Capture encryption is off."
      : "Encryption status unavailable.";
  if (view?.phase === "enabling" || view?.phase === "checking") {
    presentation.headline =
      view.phase === "enabling" ? "Enabling uploads…" : "Checking connection…";
    presentation.detail = "";
    presentation.artwork = false;
  } else if (
    commands.has("disconnect") &&
    commands.has("cancel") &&
    original.tone === "warning"
  ) {
    presentation.headline = "Disconnect this computer?";
    presentation.detail =
      "Uploads stop. Disconnecting does not delete uploaded captures.";
    presentation.tone = "warning";
    presentation.artwork = false;
  } else if (
    original.tone === "failure" ||
    view?.phase === "failed" ||
    view?.phase === "waitlisted"
  ) {
    presentation.artwork = false;
    presentation.buttons.forEach((b) => {
      if (b.command === "connect") b.title = "Try again";
    });
  } else if (
    view?.phase === "approval" ||
    commands.has("open-browser") ||
    view?.phase === "starting"
  ) {
    presentation.headline = view?.verificationUri
      ? "Approve in your browser."
      : "Connecting…";
    presentation.detail = "";
    presentation.artwork = false;
    presentation.buttons = presentation.buttons.filter((b) =>
      ["cancel", "open-browser"].includes(b.command),
    );
    step = 2;
  } else if (view?.phase === "connected" && original.tone === "success") {
    presentation.headline = "Connect ready";
    presentation.detail = mode;
    presentation.artwork = true;
  } else if (commands.has("connect") && original.tone === "neutral") {
    const paused = commands.has("request-disconnect");
    presentation.headline = "Send captures to your cloud agent.";
    presentation.detail = encrypted
      ? paused
        ? mode
        : "End-to-end encrypted captures."
      : mode;
    presentation.artwork = true;
    presentation.compact = false;
    presentation.buttons.forEach((b) => {
      if (b.command === "connect")
        b.title = paused ? "Enable uploads" : "Connect with Google";
    });
    if (!paused) step = 1;
  }
  const safeConfirmation =
    original.tone === "warning" &&
    commands.has("cancel") &&
    (commands.has("disconnect") || commands.has("disable"));
  if (safeConfirmation)
    presentation.buttons.sort(
      (a, b) => Number(b.command === "cancel") - Number(a.command === "cancel"),
    );
  return { presentation, step };
}

export function uploadDisclosure(encryption: boolean | null | undefined) {
  return `New captures upload${encryption === true ? " end-to-end encrypted" : ""}: recordings, images, voice, transcripts and context. Older captures stay local. Your agent needs separate read approval.${encryption === false ? " Capture encryption is off." : encryption !== true ? " Encryption status is unavailable." : ""}`;
}

export function connectActionRole(
  command: string,
  tone: string | undefined,
  commands: readonly string[],
) {
  if (command === "disconnect") return "destructive-action";
  if (command === "disable") return "secondary-action";
  if (command === "cancel")
    return tone === "warning" &&
      (commands.includes("disconnect") || commands.includes("disable"))
      ? "primary-action"
      : "secondary-action";
  return "primary-action";
}
