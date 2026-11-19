import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accountPresentation,
  decodeFacts,
  type AccountFacts,
} from "../../client/typescript/src/account/presentation.ts";

const signedOut: AccountFacts = {
  connected: false,
  reauthorizationRequired: false,
  renewalDue: false,
  uploadsEnabled: false,
  reusableUploadGrant: false,
  localReady: true,
  closed: false,
  encryption: true,
  retryDisable: null,
  server: "https://hosted.example",
  accountInitial: null,
  verificationUri: null,
  userCode: null,
  sharedLinksUrl: null,
  activity: "Idle",
  outcome: null,
  localError: null,
};

const authorized: AccountFacts = {
  ...signedOut,
  connected: true,
  uploadsEnabled: true,
  localReady: false,
  reusableUploadGrant: true,
  accountInitial: "A",
};

const cases = [
  [signedOut, "Send captures to your cloud agent.", "Connect with Google"],
  [authorized, "Connect ready", "Check connection"],
  [
    { ...authorized, uploadsEnabled: false },
    "Connected · uploads off",
    "Enable uploads",
  ],
  [
    { ...authorized, renewalDue: true, uploadsEnabled: false },
    "Connection needs a refresh.",
    "Check connection",
  ],
  [
    { ...authorized, reauthorizationRequired: true },
    "Sign in again.",
    "Sign in again",
  ],
  [
    { ...authorized, outcome: "Offline" },
    "Connect is offline.",
    "Check connection",
  ],
  [
    { ...signedOut, outcome: "Waitlisted" },
    "You’re on the Connect waitlist.",
    "Try again",
  ],
  [
    { ...signedOut, outcome: "Cancelled" },
    "Connection cancelled.",
    "Connect with Google",
  ],
  [
    { ...signedOut, outcome: "Rejected" },
    "Sign-in wasn’t approved.",
    "Try again",
  ],
  [{ ...signedOut, outcome: "Expired" }, "That sign-in expired.", "Try again"],
  [
    { ...authorized, outcome: "Unavailable" },
    "Connect is unavailable.",
    "Check connection",
  ],
  [
    { ...authorized, outcome: "UnverifiedCommit" },
    "Connection not confirmed.",
    "Check connection",
  ],
] as const;

test("Bend decides account status, recovery and renewal without inferring upload readiness", () => {
  for (const [facts, headline, action] of cases) {
    const view = accountPresentation(facts);
    assert.equal(view.presentation?.headline, headline);
    assert.ok(
      view.buttons.some((button) => button.title === action && button.enabled),
      headline,
    );
    assert.equal(view.phase === "connected", facts === authorized);
  }
});

test("unreadable state withdraws success and keeps revocation and retry actionable", () => {
  const emergency = accountPresentation({
    ...authorized,
    localError: "LocalState",
  });
  assert.equal(emergency.presentation?.tone, "failure");
  assert.equal(emergency.presentation?.refresh, true);
  assert.ok(
    emergency.buttons.some(
      (b) => b.command === "request-disconnect" && b.enabled,
    ),
  );
  const retry = accountPresentation({
    ...authorized,
    outcome: "LocalState",
    retryDisable: false,
  });
  assert.ok(retry.buttons.some((b) => b.command === "disable" && b.enabled));
  assert.ok(!retry.buttons.some((b) => b.command === "connect" && b.enabled));
  const confirm = accountPresentation({
    ...authorized,
    activity: "ConfirmDisconnect",
  });
  assert.equal(confirm.presentation?.tone, "warning");
  assert.deepEqual(
    confirm.buttons.map((b) => b.command),
    ["cancel", "disconnect"],
  );
  const closed = accountPresentation({ ...authorized, closed: true });
  assert.ok(closed.buttons.every((b) => !b.enabled));
});

test("native facts cannot project arbitrary copy, raw provider failures or credential fields", () => {
  const secret = "synthetic-private-canary";
  const facts = decodeFacts({
    ...authorized,
    accessToken: secret,
    refreshToken: secret,
    deviceCode: secret,
    accountEmail: secret,
    rawProviderError: secret,
    presentation: { headline: secret },
    detail: secret,
  });
  assert.ok(facts);
  assert.ok(!JSON.stringify(accountPresentation(facts)).includes(secret));
  for (const patch of [
    { server: `https://user:${secret}@example.invalid` },
    { server: `https://example.invalid/?token=${secret}` },
    { accountInitial: secret },
    { sharedLinksUrl: `https://example.invalid/hosted/shares?token=${secret}` },
    { outcome: secret },
    { activity: secret },
    { verificationUri: "https://example.invalid/device", userCode: "ABC" },
    {
      activity: "Approval",
      verificationUri: `https://example.invalid/device?deviceCode=${secret}`,
      userCode: "ABC",
    },
  ])
    assert.equal(decodeFacts({ ...authorized, ...patch }), null);
  const reauth = accountPresentation({
    ...authorized,
    outcome: "AuthRequired",
  });
  assert.equal(reauth.presentation?.accountInitial, undefined);
  assert.equal(reauth.phase, "failed");
});
