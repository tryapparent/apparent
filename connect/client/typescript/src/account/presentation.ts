import policy, {
  type Activity,
  type Grant,
  type Outcome,
  type Recovery,
} from "./account-status.mjs";
import type { ConnectAction, ConnectButton, ConnectView } from "./protocol.ts";

export const outcomes = [
  "Offline",
  "AuthRequired",
  "Waitlisted",
  "Cancelled",
  "Rejected",
  "Expired",
  "LocalState",
  "InvalidServer",
  "UnverifiedCommit",
  "Unavailable",
] as const;
export const activities = [
  "Idle",
  "Consent",
  "Starting",
  "Approval",
  "Resume",
  "Check",
  "Disable",
  "Disconnect",
  "ConfirmDisable",
  "ConfirmDisconnect",
] as const;

export type AccountFacts = {
  connected: boolean;
  reauthorizationRequired: boolean;
  renewalDue: boolean;
  uploadsEnabled: boolean;
  reusableUploadGrant: boolean;
  localReady: boolean;
  closed: boolean;
  encryption: boolean | null;
  retryDisable: boolean | null;
  server: string | null;
  accountInitial: string | null;
  verificationUri: string | null;
  userCode: string | null;
  sharedLinksUrl: string | null;
  activity: Activity;
  outcome: Exclude<Outcome, "NoOutcome"> | null;
  localError: "LocalState" | "InvalidServer" | null;
};

const flags = [
  "connected",
  "reauthorizationRequired",
  "renewalDue",
  "uploadsEnabled",
  "reusableUploadGrant",
  "localReady",
  "closed",
] as const;

export function browserUri(
  value: unknown,
  code: string | null,
): value is string {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    /[\s%#\\"'\x00-\x1f\x7f]/.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
      (!url.search || url.search === `?code=${code}`)
    );
  } catch {
    return false;
  }
}

function linksUri(value: unknown): value is string {
  if (!browserUri(value, null)) return false;
  const url = new URL(value);
  return (
    !url.search && ["/connect/shares", "/hosted/shares"].includes(url.pathname)
  );
}

export function decodeFacts(value: unknown): AccountFacts | null {
  if (!value || typeof value !== "object") return null;
  const f = value as AccountFacts;
  if (
    !flags.every((key) => typeof f[key] === "boolean") ||
    !(f.encryption === null || typeof f.encryption === "boolean") ||
    !(f.retryDisable === null || typeof f.retryDisable === "boolean") ||
    !activities.includes(f.activity) ||
    !(f.outcome === null || outcomes.includes(f.outcome)) ||
    ![null, "LocalState", "InvalidServer"].includes(f.localError) ||
    !(
      f.server === null ||
      (browserUri(f.server, null) &&
        new URL(f.server).pathname === "/" &&
        !new URL(f.server).search)
    ) ||
    !(
      f.accountInitial === null ||
      (typeof f.accountInitial === "string" &&
        /^[\p{L}\p{N}]{1,3}$/u.test(f.accountInitial))
    ) ||
    !(f.sharedLinksUrl === null || linksUri(f.sharedLinksUrl)) ||
    !(f.activity === "Approval"
      ? typeof f.userCode === "string" &&
        /^[a-zA-Z0-9-]{1,128}$/.test(f.userCode) &&
        browserUri(f.verificationUri, f.userCode)
      : f.userCode === null && f.verificationUri === null)
  )
    return null;
  return f;
}

const tag = <T extends string>(value: T) => ({ $: value });
const recoveryButton: Partial<Record<Recovery, [ConnectAction, string]>> = {
  Connect: ["connect", "Connect with Google"],
  Enable: ["connect", "Enable uploads"],
  SignIn: ["connect", "Sign in again"],
  Retry: ["connect", "Try again"],
  CheckAgain: ["check", "Check connection"],
};

export function accountPresentation(f: AccountFacts): ConnectView {
  const grant: Grant = f.reauthorizationRequired
    ? "Reapproval"
    : f.renewalDue
      ? "Renewable"
      : f.connected
        ? "Current"
        : "SignedOut";
  const status = policy.account_status(
    tag(grant),
    f.uploadsEnabled,
    tag(f.activity),
    tag(f.outcome ?? "NoOutcome"),
    tag(f.localError ?? "NoOutcome"),
  );
  const copy = policy.status_copy(status);
  const recovery = policy.recovery(status, tag(grant), f.uploadsEnabled).$;
  const buttons: ConnectButton[] = [];
  const menuActions: ConnectAction[] = [];
  const add = (
    command: ConnectAction,
    title: string,
    enabled = true,
    menu = false,
  ) => {
    buttons.push({ command, title, enabled: enabled && !f.closed });
    if (menu) menuActions.push(command);
  };
  const account =
    f.connected || f.reauthorizationRequired || f.outcome === "AuthRequired";
  const confirmation =
    f.activity === "ConfirmDisconnect" || f.activity === "ConfirmDisable";
  const disabling = f.activity === "Disconnect" || f.activity === "Disable";
  const login = f.activity === "Approval" || f.activity === "Starting";
  const passive = f.activity === "Idle";
  const action = recoveryButton[recovery];
  if (action) add(...action, f.retryDisable === null);
  if (confirmation) {
    const logout = f.activity === "ConfirmDisconnect";
    add("cancel", logout ? "Keep connected" : "Keep uploads on");
    add(
      logout ? "disconnect" : "disable",
      logout ? "Disconnect" : "Turn off uploads",
    );
  } else if (disabling) {
    add(
      f.activity === "Disconnect" ? "disconnect" : "disable",
      "Please wait…",
      false,
    );
  } else {
    if (f.activity === "Consent") {
      add("allow", "Allow & continue", f.localError === null);
      add("cancel", "Not now");
    }
    if (f.activity === "Approval") add("open-browser", "Open browser");
    if (login || f.activity === "Resume" || f.activity === "Check")
      add("cancel", "Cancel");
    if (passive && account && action?.[0] !== "check" && !f.localError)
      add("check", "Check connection", f.localError === null, true);
    if (passive || login || f.activity === "Check") {
      if (
        f.uploadsEnabled ||
        login ||
        f.activity === "Check" ||
        f.retryDisable === false ||
        f.localError
      ) {
        const retry = f.retryDisable === false;
        add(
          retry ? "disable" : "request-disable",
          f.retryDisable === false
            ? "Retry disabling uploads"
            : "Turn off uploads",
          true,
          !retry,
        );
      }
      if (
        account ||
        login ||
        f.activity === "Check" ||
        f.retryDisable === true ||
        f.localError
      ) {
        const retry = f.retryDisable === true;
        add(
          retry ? "disconnect" : "request-disconnect",
          f.retryDisable === true
            ? "Retry disconnecting"
            : "Disconnect this computer",
          true,
          !retry,
        );
      }
    }
    if (f.sharedLinksUrl && !disabling)
      add("open-shared-links", "Manage shared links", true, true);
  }
  const encryption =
    f.encryption === true
      ? "End-to-end encrypted."
      : f.encryption === false
        ? "Capture encryption is off."
        : "Encryption status unavailable.";
  const detail =
    status.$ === "SignedOutCard" && f.encryption === true
      ? "End-to-end encrypted captures."
      : status.$ === "SignedOutCard" || status.$ === "UploadsOn"
        ? encryption
        : copy.detail;
  const phase = disabling
    ? "cancelling"
    : f.activity === "Consent"
      ? "consent"
      : f.activity === "Approval"
        ? "approval"
        : f.activity === "Starting"
          ? "starting"
          : f.activity === "Resume"
            ? "enabling"
            : f.activity === "Check"
              ? "checking"
              : status.$ === "WaitlistCard"
                ? "waitlisted"
                : status.$ === "UploadsOn"
                  ? "connected"
                  : copy.tone.$ === "Failure"
                    ? "failed"
                    : "disconnected";
  const artwork = status.$ === "SignedOutCard" || status.$ === "UploadsOn";
  const tone = copy.tone.$.toLowerCase() as NonNullable<
    ConnectView["presentation"]
  >["tone"];
  return {
    title: "Apparent Connect",
    status: copy.headline,
    detail,
    note: "",
    phase,
    localReady: f.localReady,
    encryption: f.encryption,
    reusableUploadGrant: f.reusableUploadGrant,
    server: f.server,
    verificationUri: f.verificationUri,
    userCode: f.userCode,
    buttons,
    presentation: {
      tone,
      headline: copy.headline,
      detail,
      note: "",
      artwork,
      compact: status.$ !== "SignedOutCard",
      accountMenu: menuActions.length > 0,
      menuActions,
      buttons,
      sharedLinksUrl: f.sharedLinksUrl,
      ...(f.accountInitial &&
      !f.reauthorizationRequired &&
      f.outcome !== "AuthRequired"
        ? { accountInitial: f.accountInitial }
        : {}),
      step: status.$ === "SignedOutCard" ? 1 : login ? 2 : null,
      refresh: recovery === "Refresh",
    },
  };
}
