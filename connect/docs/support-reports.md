# Private desktop bug reports

Settings starts a report-specific recording. Native finishes the ordinary local
bundle and returns the owned capture's receipt to Settings. It skips normal
completion clipboard, Connect sync and agent delivery. Choosing the written
route or closing the review leaves the bundle local. Explicit Send seals the
bundle for the Apparent Support X25519 recipient and sends it through Connect.
An active Apparent Connect sign-in is required for recorded reports. The
existing upload grant identifies the account without changing its automatic
upload preferences. Written reports remain available without sign-in.

The Connect API returns the support public key to authorized clients when
`SUPPORT_REPORT_RECIPIENT` and `SUPPORT_REPORT_READ_TOKEN` are configured.
Desktop's native client seals the recording to a private age file, splits
it into ordinary Connect upload parts and streams them using its existing
grant. Each account has a separate 500 MB allowance for reports. Report uploads
and ordinary captures cannot evict one another and both use Connect's
shared storage budget.
The report is unavailable through regular capture and share routes.

The report ID and PostHog event ID are generated on the device. An open
draft retains the same ciphertext for an identical retry. Downloads
require the separate Support read token. The decryption key stays with
the private reader. The sealed bundle binds the report ID and origin, and
the reader verifies paths, sizes, hashes and bundle references before
serving the completed archive. Ready reports use ordinary Connect cleanup.
Legacy reports remain readable until they expire.

After Connect acknowledges the ciphertext, Desktop creates a PostHog Error
Tracking entry containing the opaque report ID, app build and platform. It
sends no recording content, paths or credentials to PostHog. The fixing
worker gives the fix thread access to this report through a revocable
Unix-socket download with an OS peer check. The worker retrieves and decrypts
the recording on demand.
[Fix queue configuration](../../enablement/posthog-fixer/README.md).

## Activation and rollback

Use existing Connect D1 and the private bucket. Provision a dedicated support
read token (64 lowercase hex characters) as a Worker secret and advertise the
matching support age public key as `SUPPORT_REPORT_RECIPIENT`. Apply the
additive migrations before enabling the configuration. The Worker uses the
combined allowance until the quota isolation migration is applied. Install the decrypting
Apparent binary and configure the existing fixer with the paired private key
before advertising the public key. Drain or retain access to unexpired
reports when replacing the key.

Install the multipart-capable fixer and native reader before enabling the
new desktop release. The reader also accepts the legacy ciphertext route.
Clients that implemented anonymous recording reports continue to offer
written reports. They need a desktop update for recorded submission.
Use a controlled synthetic fixture to validate the complete setup.
