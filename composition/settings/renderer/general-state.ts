export type Shortcut = {
  kind: "record" | "paste";
  title: string;
  label: string;
  recording: boolean;
  externallyManaged: boolean;
  isDefault: boolean;
  clearable: boolean;
  error: string | null;
};
export type GeneralState = {
  platform: "linux" | "macos";
  login: { on: boolean; available: boolean; needsApproval: boolean };
  shortcuts: Shortcut[];
  errorReporting: boolean;
};

export type Request = {
  action: Record<string, unknown>;
  prepare?: Record<string, unknown>;
  before: GeneralState;
  timer: ReturnType<typeof setTimeout>;
};
export type Failure =
  | { kind: "read"; message: string; retry: () => void }
  | {
      kind: "change";
      message: string;
      retry: () => void;
      request: Request;
      unconfirmed: boolean;
    };
export function requestKey(
  action: Record<string, unknown>,
  state: GeneralState,
) {
  return action.action === "set"
    ? String(action.key)
    : String(
        action.kind ??
          state.shortcuts.find((s) => s.recording)?.kind ??
          "shortcut",
      );
}
export function requestName(request: Request) {
  const { action, before } = request;
  if (action.action === "set")
    return (
      (
        {
          launchAtLogin: "Launch at login",
          errorReporting: "Error reporting",
        } as Record<string, string>
      )[String(action.key)] ?? "Preference"
    );
  const shortcut = before.shortcuts.find(
    (s) =>
      s.kind ===
      (action.kind ?? before.shortcuts.find((s) => s.recording)?.kind),
  );
  return `${shortcut?.kind === "paste" ? "Paste" : (shortcut?.title ?? "Recording")} shortcut`;
}
export function failureKey(failure: Failure) {
  return failure.kind === "change"
    ? `change:${requestKey(failure.request.action, failure.request.before)}`
    : failure.kind;
}
export function unconfirmedHelp(action: Record<string, unknown>) {
  if (action.action !== "set") return "Reopen Settings to check the shortcut.";
  return `Reopen Settings to check whether it’s ${action.value ? "on" : "off"}.`;
}
export function confirmationSummary(request: Request) {
  const a = request.action;
  if (a.action !== "set")
    return `Last confirmed: ${request.before.shortcuts.find((s) => s.kind === (a.kind ?? request.before.shortcuts.find((s) => s.recording)?.kind))?.label || "Off"}.`;
  const before =
    a.key === "launchAtLogin"
      ? request.before.login.on
      : request.before[a.key as "errorReporting"];
  const format = (value: unknown) => (value ? "On" : "Off");
  return `Last confirmed: ${format(before)}. Requested: ${format(a.value)}.`;
}
export function confirmed(next: GeneralState, request: Request) {
  const a = request.action;
  if (a.action === "set")
    return (
      (a.key === "launchAtLogin"
        ? next.login.on
        : next[a.key as "errorReporting"]) === a.value
    );
  const shortcut = next.shortcuts.find(
    (s) =>
      s.kind ===
      (a.kind ?? request.before.shortcuts.find((s) => s.recording)?.kind),
  );
  if (!shortcut) return false;
  if (
    shortcut.error &&
    shortcut.error !==
      request.before.shortcuts.find((s) => s.kind === shortcut.kind)?.error
  )
    return true;
  if (a.action === "record-shortcut") return shortcut.recording;
  if (a.action === "cancel-shortcut") return !shortcut.recording;
  if (a.action === "reset-shortcut") return shortcut.isDefault;
  if (a.action === "clear-shortcut") return !shortcut.label;
  const previous = request.before.shortcuts.find(
    (s) => s.kind === shortcut.kind,
  );
  return (
    !shortcut.recording &&
    (!!previous?.recording || shortcut.label !== previous?.label)
  );
}
