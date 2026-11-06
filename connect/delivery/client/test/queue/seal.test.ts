import assert from "node:assert/strict";
import { test } from "node:test";
import * as ed25519 from "@noble/ed25519";
import { generateAgeIdentity, verifyEnvelope, joinAgeParts } from "../../src/recipient/crypto.ts";
import { openRecipientArchive } from "../../src/recipient/archive.ts";
import { validateRecipientEnvelopeBytesWithVerifier } from "../../src/recipient-envelope.ts";
import type { SenderPeerAuthority } from "../../src/sender/authority.ts";
import { decodePeerAuthority } from "../../src/recipient/peer-authority.ts";
import { sealCapture, SealError } from "../../src/sender/seal.ts";

const seed = new Uint8Array(32).fill(41), hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
async function fixture() {
  const self = await generateAgeIdentity(), reader = await generateAgeIdentity(), other = await generateAgeIdentity();
  const ownPublicKey = { version: 1 as const, recipient: self.recipient, signing: hex(await ed25519.getPublicKeyAsync(seed)) };
  const value = { server: "https://connect.example", accountId: "acct", grantId: "sender", scope: "upload" as const,
    devices: [
      { grantId: "reader", scope: "read" as const, key: { version: 1 as const, recipient: reader.recipient, signing: ownPublicKey.signing } },
      { grantId: "sender", scope: "upload" as const, key: ownPublicKey },
      { grantId: "other-upload", scope: "upload" as const, key: { version: 1 as const, recipient: other.recipient, signing: ownPublicKey.signing } },
      { grantId: "reader-shared", scope: "read" as const, key: { version: 1 as const, recipient: reader.recipient, signing: ownPublicKey.signing } },
    ] };
  const { server: _server, ...wire } = value;
  const authority = Object.freeze({ ...decodePeerAuthority(wire, { scope: "upload", grantId: value.grantId, ownPublicKey }), server: value.server, scope: "upload" as const }) as SenderPeerAuthority;
  const files = [
    { path: "summary.md", bytes: new TextEncoder().encode("summary") },
    { path: "contact-sheet.png", bytes: Uint8Array.of(1, 2, 3) },
    { path: "apparent.json", bytes: new TextEncoder().encode(JSON.stringify({ contactSheet: "contact-sheet.png", audio: "audio.wav", keyframes: [] })) },
    { path: "recording.mp4", bytes: Uint8Array.of(8, 9) },
    { path: "audio.wav", bytes: Uint8Array.of(6, 7) },
  ];
  return { ownPublicKey, authority, files, self, reader, other };
}
const input = (f: Awaited<ReturnType<typeof fixture>>, profile: "root" | "evidence-first-v1" = "root", active = () => true) => ({
  server: f.authority.server, captureId: "a".repeat(32), ownPublicKey: f.ownPublicKey, signingSeed: seed,
  authority: f.authority, profile, files: f.files, active,
});

test("seals root and grouped bytes for read peers and sender self with verified signed archives", async () => {
  const f = await fixture();
  for (const profile of ["root", "evidence-first-v1"] as const) {
    const sealed = await sealCapture(input(f, profile));
    assert.deepEqual(sealed.recipientGrantIds, ["reader", "sender", "reader-shared"]);
    const groups = profile === "root" ? [{ context: sealed.context, envelope: sealed.envelope, chunks: sealed.chunks, prefix: "" }] : sealed.groups.map(g => ({ ...g, prefix: `${g.context.group}/` }));
    for (const group of groups) {
      const envelopeBytes = sealed.assets.find(a => a.path === `${group.prefix}envelope.json`)!.bytes;
      const envelope = await validateRecipientEnvelopeBytesWithVerifier(envelopeBytes, group.context, new Uint8Array(Buffer.from(f.ownPublicKey.signing, "hex")), verifyEnvelope);
      const chunks = group.chunks.map(c => sealed.assets.find(a => a.path === (profile === "root" ? c.path : c.path))!.bytes);
      assert.equal(envelope.signed.chunks.length, chunks.length);
      for (const identity of [f.reader.identity, f.self.identity]) {
        const opened = await openRecipientArchive({ envelope: envelopeBytes, parts: chunks, identity,
          expected: group.context, trustedSenderSigningKey: new Uint8Array(Buffer.from(f.ownPublicKey.signing, "hex")) });
        assert.ok(opened.files.some(file => file.path === "summary.md") === (group.context.group !== "media"));
      }
    }
    assert.ok(!sealed.assets.some(a => a.bytes === f.files[0]!.bytes));
    for (const asset of sealed.assets) asset.bytes.fill(0);
  }
});

test("requires at least one read peer and rejects mismatched keys, contexts, paths, and cancellation", async () => {
  const f = await fixture();
  const noReader = { ...f.authority, devices: f.authority.devices.filter(p => p.scope === "upload") };
  await assert.rejects(sealCapture({ ...input(f), authority: noReader }), e => e instanceof SealError && e.category === "encryption_pending_recipient");
  await assert.rejects(sealCapture({ ...input(f), signingSeed: new Uint8Array(32) }), e => e instanceof SealError && e.category === "encryption_key_binding_mismatch");
  await assert.rejects(sealCapture({ ...input(f), server: "https://elsewhere.example" }), e => e instanceof SealError);
  await assert.rejects(sealCapture({ ...input(f), files: [...f.files, { path: "../bad", bytes: Uint8Array.of(1) }] }), e => e instanceof SealError);
  await assert.rejects(sealCapture(input(f, "root", () => false)), e => e instanceof SealError && e.category === "stale_snapshot");
  const controller = new AbortController(); controller.abort();
  await assert.rejects(sealCapture({ ...input(f), signal: controller.signal }), e => e instanceof SealError && e.category === "cancelled");
});

test("detaches the file list and bytes before the first async crypto operation", async () => {
  const f = await fixture(); let changed = false;
  const sealed = await sealCapture({ ...input(f), active: () => {
    if (!changed) { changed = true; f.files[0]!.bytes.fill(0); }
    return true;
  } });
  const envelope = sealed.assets.find(a => a.path === "envelope.json")!.bytes;
  const chunks = sealed.chunks.map(c => sealed.assets.find(a => a.path === c.path)!.bytes);
  const opened = await openRecipientArchive({ envelope, parts: chunks, identity: f.self.identity, expected: sealed.context,
    trustedSenderSigningKey: new Uint8Array(Buffer.from(f.ownPublicKey.signing, "hex")) });
  assert.equal(new TextDecoder().decode(opened.files.find(file => file.path === "summary.md")!.bytes), "summary");
  assert.equal(f.files[0]!.bytes.every(b => b === 0), true);
  for (const asset of sealed.assets) asset.bytes.fill(0);
});
