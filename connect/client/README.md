# Connect CLI reader profiles

On the machine and OS account that runs the agent, create one named reader
per sender account. Have each sender open their own verification link and
approve the read grant while signed in to the Connect account they upload from.

```sh
apparent connect login --server https://hosted.tryapparent.com --reader sender-one --no-browser
apparent connect login --server https://hosted.tryapparent.com --reader sender-two --no-browser
apparent connect readers
apparent inspect <capture-id>
```

Run `apparent connect list` to see recent capture IDs, recording times, ages
and upload states. Use `--reader <name>` to choose the account and `--limit 1 --json`
to get the newest result and the reader to use when inspecting it. Without a
reader argument, the CLI uses the approved default reader or the only approved
named reader. With multiple named readers and no default, choose one explicitly.
Connect includes pending uploads and orders recordings with known timestamps
newest first. Legacy recordings with unknown times follow, newest reservation first.

`inspect`, `fetch` and `connect files` look up bare capture IDs using the default
reader and the named readers approved on the configured API origin (or
`https://hosted.tryapparent.com` if no origin is configured). Use `--reader <name>`
to select a specific identity, including a reader approved on a different origin.
`--reader default` selects the existing unnamed reader explicitly. If two
profiles are approved under the same account, use the one that was approved
when the capture was encrypted. Adding a profile does not grant access to old
ciphertext that did not include its public key.

Each named reader keeps its own read credential, renewal state and endpoint keys
under `hosted/readers/<name>/`. Upload consent and the default reader stay in
place. `apparent connect logout
--reader <name>` signs out that profile. An unqualified logout signs out the
original default credentials. A shared agent runtime can access every reader
profile available to its OS account.

## Native client integration

Blocking `ConfigProvider::set_cloud_allowed` implementations must recheck
cancellation inside their transaction. The Connect renewal transport receives
nonsecret decisions through `ConfigProvider::renewal_transition`. The
application embeds the owner module and the standalone client uses its
compiled Node entrypoint.

## Recording list API

`GET /v1/captures?limit=10` requires an approved device bearer and returns
`{captures:[{id,recordedAt,ageSeconds,status}]}` for that account. The limit
accepts 1–50. Pending and ready captures are eligible until expiry, with support
reports excluded. Entries with recording times sort newest first. Ties and
unknown times use descending reservation sequence, with unknown times last.
`recordedAt` is UTC, `ageSeconds` is a nonnegative integer, and both are null
when the client supplied no recording timestamp.

A new reservation can include `recordedAtMs`, the bundle's Unix epoch recording
timestamp in milliseconds. Connect stores it outside the encrypted payload
for sorting before an upload completes. The value is visible to Connect and to
approved device readers of the owning account. Older reservations keep their
original metadata when retried. Until the operator applies migration
`0021.sql`, uploads continue and the list uses reservation order with unknown
recording times.
