import assert from "node:assert/strict";
import { test } from "node:test";
import * as ed25519 from "@noble/ed25519";
import { generateAgeIdentity } from "../../src/recipient/crypto.ts";
import { decodePeerAuthority, PeerAuthorityError } from "../../src/recipient/peer-authority.ts";

const seed = new Uint8Array(32).fill(7);
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
async function frame(scope: "read" | "upload" = "read") {
  const age = await generateAgeIdentity(), signing = await ed25519.getPublicKeyAsync(seed);
  const ownKey = { version: 1 as const, recipient: age.recipient, signing: hex(signing) };
  return {
    ownKey,
    value: { accountId: "acct", grantId: "grant", scope,
      devices: [{ grantId: "grant", scope, key: { ...ownKey } }] },
  };
}
const rejects = (category: string) => (error: unknown) => error instanceof PeerAuthorityError
  && error.category === category && error.message === category;

test("decodes read and upload authority with validated AGE and Ed25519 public keys", async () => {
  for (const scope of ["read", "upload"] as const) {
    const f = await frame(scope);
    const result = decodePeerAuthority(f.value, { scope, grantId: "grant", ownPublicKey: f.ownKey });
    assert.equal(result.scope, scope);
    assert.equal(result.devices[0]!.key.recipient, f.ownKey.recipient);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.devices) && Object.isFrozen(result.devices[0]) && Object.isFrozen(result.devices[0]!.key));
  }
});

test("requires exact grant, scope, and own-key binding", async () => {
  const f = await frame();
  assert.throws(() => decodePeerAuthority(f.value, { scope: "upload", grantId: "grant", ownPublicKey: f.ownKey }), rejects("invalid_encryption_authorization"));
  assert.throws(() => decodePeerAuthority(f.value, { scope: "read", grantId: "other", ownPublicKey: f.ownKey }), rejects("invalid_encryption_authorization"));
  assert.throws(() => decodePeerAuthority({ ...f.value, devices: [] }, { scope: "read", grantId: "grant", ownPublicKey: f.ownKey }), rejects("encryption_approval_required"));
  const other = await generateAgeIdentity();
  assert.throws(() => decodePeerAuthority(f.value, { scope: "read", grantId: "grant", ownPublicKey: { ...f.ownKey, recipient: other.recipient } }), rejects("encryption_key_binding_mismatch"));
});

test("rejects duplicate IDs, unknown fields, malformed keys, and over-limit devices", async () => {
  const f = await frame();
  const run = (value: unknown) => decodePeerAuthority(value, { scope: "read", grantId: "grant", ownPublicKey: f.ownKey });
  assert.throws(() => run({ ...f.value, extra: true }), rejects("invalid_encryption_authorization"));
  assert.throws(() => run({ ...f.value, devices: [f.value.devices[0], f.value.devices[0]] }), rejects("invalid_encryption_authorization"));
  assert.throws(() => run({ ...f.value, devices: Array.from({ length: 65 }, (_, i) => ({ ...f.value.devices[0], grantId: `d${i}` })) }), rejects("invalid_encryption_authorization"));
  const badAge = structuredClone(f.value); badAge.devices[0]!.key.recipient = "age1" + "a".repeat(58);
  assert.throws(() => run(badAge), rejects("invalid_encryption_authorization"));
  const badChecksum = structuredClone(f.value); badChecksum.devices[0]!.key.recipient = f.ownKey.recipient.slice(0, -1) + (f.ownKey.recipient.endsWith("a") ? "b" : "a");
  assert.throws(() => run(badChecksum), rejects("invalid_encryption_authorization"));
  for (const signing of ["00".repeat(32), "01" + "00".repeat(31)]) {
    const badPoint = structuredClone(f.value); badPoint.devices.push({ grantId: "rogue", scope: "upload", key: { ...f.ownKey, signing } });
    assert.throws(() => run(badPoint), rejects("invalid_encryption_authorization"));
  }
});

test("returns detached frozen public-only data and does not expose a token", async () => {
  const f = await frame(); const input = structuredClone(f.value);
  const result = decodePeerAuthority(input, { scope: "read", grantId: "grant", ownPublicKey: f.ownKey });
  input.accountId = "changed"; input.devices[0]!.key.recipient = "changed";
  assert.equal(result.accountId, "acct"); assert.equal(result.devices[0]!.key.recipient, f.ownKey.recipient);
  assert.equal("token" in result, false); assert.equal(JSON.stringify(result).includes("secret"), false);
});
