# PostHog fix queue

A Node 22.23+ TypeScript service receives new Error Tracking issue notifications,
records their IDs in private SQLite state, and launches a T3 fix thread in an
isolated `origin/main` worktree. No Rust, Electron, npm install or hosted service
is required. This directory is Enablement-owned; it is not an application or
Connect dependency. Tests run in the local/hosted tooling suite.

The initial scope is **issue created**, not every `$exception`, reopened issues,
spikes or backfilling existing errors. Duplicate deliveries remain deduplicated
by project/issue, including after restart and completion. The service never marks
PostHog issues resolved: a merged fix alone does not establish production recovery.

## Configure and run

The committed unit is a template, not an installed or enabled service. Select the
actual T3 environment and Apparent project before activation. Use the executable
matching that environment's data home; the generic `t3` command may be a different
version. The adapter targets the installed Nightly V2 Effect RPC contract verified
with `0.1.8-nightly.20261106.4262`. Requalify it after T3 upgrades.

Create a private configuration directory and a private persistent state directory
(e.g. `~/.config/apparent-posthog-fixer` and `~/.local/state/apparent-posthog-fixer`).
These are required runtime data, not build/test artifacts. Keep environment and
secret files owned by the service user with mode 0600, directories 0700.
Configure these environment variables (absolute paths, no shell expansion in a
systemd EnvironmentFile):

| Variable | Value |
| --- | --- |
| `POSTHOG_PROJECT_ID` | `329943` by default; verify the intended project |
| `POSTHOG_ORIGIN` | `https://eu.posthog.com` by default; US also supported |
| `POSTHOG_COMMAND` | Absolute path to the authenticated official PostHog CLI or pinned launcher |
| `T3_ORIGIN` | Owning server origin, HTTPS or loopback HTTP |
| `T3_PROJECT_ID` | Exact registered Apparent project UUID |
| `T3_PROVIDER_INSTANCE`, `T3_MODEL` | Explicit installed provider instance and available model |
| `T3_RUNTIME_MODE` | `auto-accept-edits` by default; `auto` also supported |
| `T3_TOKEN_FILE` | Absolute private file containing only the T3 bearer |
| `WEBHOOK_TOKEN_FILE` | Absolute private file containing a random token of at least 32 characters |
| `STATE_DIRECTORY` | Absolute private queue directory |
| `PORT`, `DAILY_LIMIT`, `QUEUE_LIMIT` | Defaults: `8646`, `10`, `100` |

Use the owning T3 CLI's `auth session issue` with only `orchestration:read` and
`orchestration:operate` and a bounded TTL. Capture its token directly into the
private file, not terminal output or Git. Renew before expiry by atomically
replacing the file. Both credentials are read on each request; other environment
changes require a service restart. The service does not mint tokens or change
T3 provider/permission settings. Permission requests may still need human input.

The PostHog CLI must already be authenticated for read access to this project.
The bridge uses explicit host/project flags; it fetches compact issue details
without personal breakdowns. A fix thread may retrieve a representative exception
using existing access when necessary. Desktop content-free diagnostics may be
insufficient; the thread must report that evidence gap. The immutable launch
payload persists privately in SQLite and T3; do not publish private diagnostic data.

Run with the configured environment:

```sh
node --experimental-strip-types enablement/posthog-fixer/main.ts
```

For systemd, adjust the unit's checkout, Node PATH and state paths to the actual
installation. Create the state directory before starting the sandboxed unit. The
service binds only `127.0.0.1`. Expose **only** `POST /webhooks/posthog` through an
existing HTTPS reverse proxy; preserve Authorization, limit requests to 16 KiB,
and do not log headers or bodies. Never expose T3 itself through this webhook
route. `/health` reports process availability, not PostHog/T3 readiness.

## PostHog destination

In Error Tracking → Configuration → Alerting, create an HTTP Webhook destination
filtered to `$error_tracking_issue_created`. Set POST, Content-Type
`application/json`, and this minimal body (PostHog's template expressions):

```json
{
  "project_id": 329943,
  "event": {
    "event": "{event.event}",
    "distinct_id": "{event.distinct_id}"
  }
}
```

Set **Secret headers** to `Authorization: Bearer <webhook-token>` and disable debug
logging. Do not put the token in the URL or plaintext headers. This uses the
configurable encrypted secret-header input, not an assumed PostHog HMAC header.
PostHog's issue lifecycle producer uses `event.distinct_id` for the issue UUID.
The default full `{event}`/`{person}` body is unnecessary. Other event types are
acknowledged as ignored; a mismatched project or invalid issue UUID is rejected.
The receiver returns 202 only after a durable enqueue; duplicates also return 202.
A full queue or unavailable storage returns 503 for upstream retry. Confirm the
destination's real retry policy before relying on it for outage recovery.

Sources: [webhook template](https://github.com/PostHog/posthog/blob/master/nodejs/src/cdp/templates/_destinations/webhook/webhook.template.ts),
[issue lifecycle producer](https://github.com/PostHog/posthog/blob/master/products/error_tracking/backend/temporal/lifecycle/side_effects.py),
[alert setup](https://posthog.com/docs/error-tracking/alerts).

## Limits, recovery and rollback

One service process owns each queue through a crash-released SQLite lock. At most
one fix is launching/active. Waiting threads and terminal runs in unsettled
threads retain that slot, including PR watches. The next job starts only once T3
reports the prior thread settled with all runs terminal. Normal agent completion
is not evidence of a merged fix. Existing repository delivery gates remain in
force. If a failed/blocked thread will not continue, settle it deliberately in T3.

The UTC daily cap counts durable launch reservations, including uncertain launches.
After an RPC failure the service retries the exact persisted command, thread ID
and prompt, at most three attempts with one-minute backoff. It then holds the slot
for operator reconciliation. Context-read failures retry separately, then hold
the issue without consuming a launch slot. Unknown/malformed T3 status retains
active work. Queue identity is bound to both origins and both projects; changing
targets requires a different state directory. Completed deduplication rows are
retained; deleting them would permit old notifications to launch again.

Stop the service before using its exclusive queue management commands, with the
same environment as the service:

```sh
node --experimental-strip-types enablement/posthog-fixer/manage.ts list
node --experimental-strip-types enablement/posthog-fixer/manage.ts retry <held-issue-uuid>
```

Inspect the recorded T3 thread before retrying an uncertain launch. Retry preserves
its payload and IDs; it cannot create a replacement worker. Renew expired
credentials or repair connectivity first. No automatic suppression, cancellation,
merge bypass, backlog deletion, remote exposure or activation occurs on install.
To roll back activation, disable the PostHog destination, stop the service, and
retain its private queue and T3 threads for reconciliation.

## Verification

```sh
node --experimental-strip-types --test enablement/posthog-fixer/test/*.test.ts
```

Tests use private temporary SQLite databases, synthetic PostHog producer-shaped
inputs, real loopback HTTP and a minimal RFC6455/Effect peer. They do not contact
production or launch paid agents. An isolated actual T3 server was also exercised
for ticket authentication, idle launch, same-command replay and projection readback;
that proves the adapter protocol, not a production fix or inference run. Activation
still needs an isolated end-to-end notification with the intended environment and
credentials. Follow PostHog synthetic-validation guidance before any ingestion test.
