# Hosted end-to-end encryption — implementation contract (#189)

Status: design in progress; not implemented, deployed, audited or enabled. Current
hosted transfers remain readable by the service. Do not describe HTTPS or storage
provider encryption as end-to-end encryption.

## Ownership

Connect owns cryptographic packaging, local device keys, authenticated transfer
and remote fetch. Implement this in the independent `connect/client` boundary,
not the old `src/hosted.rs` donor or Capture Engine. Desktop/Agent still own
whether a capture may leave the device. Local recording and clipboard fallback
must work when encryption, key access or the network fails.

## Security boundary

Trusted: explicitly enrolled recording and reading endpoints, their installed
client, OS, same-user processes and private filesystem. A compromised endpoint
can read its captures and keys. Root, same-user malware, malicious client updates,
screen capture at an endpoint and compromised recovery copies are not prevented.

Untrusted for content confidentiality: the account backend, storage operator,
network and a stolen account session or bearer token. Account login permits
transport operations only. It must never enroll a decryption or signing key.
An attacker may still deny service, delete or withhold ciphertext, exhaust allowed
budgets, or replay an existing authorized capture under its original identity.

Remaining metadata: account and transport authorization, random capture ID,
protocol version, ciphertext chunk count/sizes/hashes, reservation/expiry/access
times and any sender verification-key identifier required by the signed envelope.
No original filenames, plaintext hashes, transcripts, application context, media,
manifest contents or content keys may appear in server-visible metadata.

## Primitive and authenticity requirements

Use an established streaming authenticated-encryption format with published
specification and reviewed primitives. Do not implement nonce derivation, key
wrapping or an AEAD construction locally. The proposed payload format is age v1
with native X25519 recipients. Use a pinned maintained implementation and record
its exact dependencies and the applicability/limits of external security reviews.

Recipient encryption alone does **not** authenticate the sender: anyone who knows
a recipient public key can create a new valid age ciphertext. Therefore a trusted
sender must also authenticate the complete ciphertext descriptor, including the
capture ID, protocol/version, origin binding, ordered chunk paths/sizes/hashes
and algorithm. Verify that authentication against an independently pinned local
sender key before publishing plaintext. A backend-provided signing key is not a
trust anchor. Independent integration review remains required; an agent review
is not a professional cryptographic audit.

## Enrollment, recovery and revocation

Generate device secret material locally. Keep it in explicitly private key
artifacts, separate from account credentials and from inspectable preferences.
Never print secret keys, put them in argv, copy them to the clipboard or include
them in a capture, log, prompt or server request. Public device descriptors can
be exchanged as files; the user verifies their complete fingerprint over an
independent trusted channel before explicitly trusting the device. Backend key
discovery, Google login and bearer-token renewal cannot change local key trust.

A recorder encrypts only to its locally approved recipient set. A reader accepts
only locally approved senders. Enrollment does not automatically grant access to
historical captures. Granting historical access requires an authorized endpoint
to explicitly decrypt/re-encrypt under a fresh remote ID. Do not mutate an
already reserved ciphertext manifest.

Removing a recipient prevents new encryption to that key; removing sender trust
prevents subsequent fetch acceptance from that sender. Rotation generates new
keys and requires explicit enrollment. Cancel or explicitly restage pending work
that still targets a removed recipient; do not silently continue it. Revocation
cannot erase downloaded keys, ciphertext or plaintext, or prevent an authorized
recipient from retaining or forwarding them.

Recovery is an offline, user-controlled copy of private key artifacts in protected
storage. Recovering account access or resetting a password cannot recover lost
content keys. Losing every suitable identity and backup makes those captures
unrecoverable. Restoring a key must use explicit private-file import, never a
secret pasted into chat. Retain old keys when needed to read old ciphertext;
rotation alone does not re-encrypt history.

## Transfer and publication

Encrypt all allowed bundle files, including every content-bearing manifest field,
inside one bounded streaming archive. Its authenticated inner descriptor carries
original paths, lengths and SHA-256 values plus the capture identity. Reject
unknown/duplicate/unsafe paths, missing required assets and invalid references.

Persist a complete immutable ciphertext spool before reserving remote work.
Split ciphertext transport into bounded opaque chunks without resetting or
reimplementing the encryption stream. Retries resume identical persisted bytes;
never regenerate randomized ciphertext under a reserved ID. A crash before spool
publication discards the incomplete private spool. A lost or corrupt committed
spool requires explicit fresh-ID recovery, not plaintext fallback.

Transport integrity is the chunk size/hash set checked by the service. Plaintext
integrity additionally requires trusted sender authentication, successful age
finalization, the exact inner file set/lengths/hashes and existing bundle-reference
validation. Missing/reordered/replaced/truncated chunks, wrong keys, forged
sender keys or an authentication failure must leave no ready local output.
Decrypt only in a new private sibling stage and atomically publish without
replacement after all checks. Bound allocations, file count, plaintext total and
encryption header work before consuming untrusted input.

Keep existing owner/scope checks, account quotas, operation/physical-attempt
budgets, expiry, tombstones and cleanup. Charge ciphertext overhead; encryption
does not authorize higher limits. The service must not decrypt to apply those
limits. Ciphertext chunks are transport objects, not independent media assets;
this does not implement plaintext resumable upload issue #188. Coordinate its
future framing/version contract without duplicating a second transfer service.

## Compatibility, consent and rollout

Use an explicit versioned opaque manifest. Reject unknown versions, mixed
plaintext/encrypted manifests and downgrade attempts; never guess encryption
from a file extension. Existing plaintext captures remain explicitly plaintext.
No background scan, migration or retroactive confidentiality promise. An explicit
historical encrypted upload creates a fresh ID; deleting the earlier plaintext
remote copy is a separate user action and cannot erase previously retained copies.

The candidate stays off by default behind an inspectable experiment. Selecting
encryption with missing/invalid keys fails closed locally; it must never fall back
to an ordinary plaintext upload. Pin encryption mode at admission so a setting
change cannot downgrade a pending encrypted job. Preserve queue → config lock
order, current consent checks, cancellation and grant-generation protections.
Account disable/logout cannot silently destroy recovery keys or restore consent.
Credential renewal (#187) remains transport authority, not device-key enrollment.

Current server-rendered public sharing cannot decrypt an opaque capture. Reject
sharing of encrypted captures at both client and server; do not put decryption
keys in links or fall back to plaintext to make sharing work. Browser decryption
and encrypted public-link sharing are not implied by this CLI/device feature.

## Required proof before completion

Exercise the production upload/fetch boundary with synthetic bundles: no plaintext
sent; exact recovery; tampering, truncation, wrong keys and foreign capture/origin
binding rejected; untrusted sender/device enrollment refused; revoked recipients
excluded from newly staged jobs; interrupted spools/transfers resumed without
ciphertext mutation or partial local publication; recovery and complete-key-loss
behavior; disable/logout/credential replacement races; legacy and unknown-version
compatibility; encrypted sharing refusal; unchanged quota/budget/cleanup denials.
Run independent security-focused source review and actual macOS/Linux client
interoperability. Build results alone are not interoperability evidence. Record
unrun gates honestly and keep the feature disabled until they are met.
