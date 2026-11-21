# Private desktop bug reports

Settings starts a report-specific recording. Native finishes the ordinary local
bundle and returns the owned capture's receipt to Settings. It skips normal
completion clipboard, Connect sync and agent delivery. Choosing the written
route or closing the review leaves the bundle local. Explicit Send seals the
bundle for the Apparent Support X25519 recipient and sends it through Connect.
This flow neither signs in to a Connect account nor changes the recording
computer's upload preferences.

The Connect API advertises the support public key only when
`SUPPORT_REPORT_RECIPIENT` and `SUPPORT_REPORT_READ_TOKEN` are configured. It
stores a single bounded age stream with the existing archive descriptor
and assets inside. The report ID and upload receipt secret are randomly
generated on the device. The receipt secret authorizes an identical retry
only. Downloads require the separate support read token. The decryption key
is never sent to Connect. The sealed bundle binds the report ID and origin
inside its authenticated ciphertext, and the reader validates paths, sizes,
hashes and bundle references before publishing a local directory.

The transport accepts up to 24 MiB of ciphertext. Source, report and global
rate limits cap anonymous uploads, with a 2 GiB live reservation ceiling.
Incomplete reservations expire in fifteen minutes. Ready reports expire in
seven days and are removed by the existing Connect cleanup schedule. A report
keeps the original local bundle even if preview, encryption, upload or
PostHog ingestion fails. An open draft retries with the same upload secret,
ciphertext and PostHog event ID.

After Connect acknowledges the ciphertext, Desktop creates a PostHog Error
Tracking entry containing the opaque report ID, app build and platform. It
sends no recording content, paths or credentials to PostHog. The fixing
worker retrieves the encrypted recording and opens it with its own key
before starting the fix. [Fix queue configuration](../../enablement/posthog-fixer/README.md).

## Activation and rollback

Use existing Connect D1 and the private bucket. Provision a dedicated support
read token (64 lowercase hex characters) as a Worker secret and advertise the
matching support age public key as `SUPPORT_REPORT_RECIPIENT`. Apply the
additive migration before enabling the configuration. Install the decrypting
Apparent binary and configure the existing fixer with the paired private key
before advertising the public key. Drain or retain access to unexpired
reports when replacing the key.

The public key endpoint returns unavailable before this setup. Desktop then
offers written reports, and no local capture is started via the recorded
route. Removing the advertised public key stops new desktop report sessions.
Use a controlled synthetic fixture to validate the complete setup before
accepting real media.
