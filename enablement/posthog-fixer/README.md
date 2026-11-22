# PostHog fix queue

A Node 22.23+ TypeScript service receives new Error Tracking issue notifications,
records their IDs in private SQLite state, and launches a T3 fix thread in an
isolated `origin/main` worktree. No Rust, Electron, npm install or hosted service
is required. Tests run in the tooling suite.

The initial scope is **issue created**, not every `$exception`, reopened issues,
spikes or backfilling existing errors. Duplicate deliveries remain deduplicated
by project/issue, including after restart and completion. The queue itself never marks PostHog issues resolved. Fix threads maintain status
and GitHub links through the instructions below; settlement is not proof of recovery.

## Configure and run

The unit is an installation template. Verify the owning T3 environment, project
and CLI before activation; requalify the RPC adapter after T3 upgrades.

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
| `T3_REASONING_EFFORT` | Codex reasoning effort; defaults to `high` for `codex` |
| `T3_RUNTIME_MODE` | `full-access` by default; `auto-accept-edits` and `auto` also supported |
| `T3_TOKEN_FILE` | Absolute private file containing only the T3 bearer |
| `WEBHOOK_TOKEN_FILE` | Absolute private file containing a random token of at least 32 characters |
| `STATE_DIRECTORY` | Absolute private queue directory |
| `PORT`, `DAILY_LIMIT`, `QUEUE_LIMIT` | Defaults: `8646`, `10`, `100` |

Use the owning T3 CLI's `auth session issue` with only `orchestration:read` and
`orchestration:operate` and a bounded TTL. Capture its token directly into the
private file, not terminal output or Git. Renew before expiry by atomically
replacing the file. Both credentials are read on each request; other environment
changes require a service restart. The service does not mint tokens or change
T3 provider settings. New fix threads use the configured permission mode; this
does not relax the task's spending, access, consent or privacy limits. The deployed
Apparent configuration uses `codex`, `gpt-6.2-sol`, `high`, and `full-access`.

The PostHog CLI must already be authenticated for read access to this project.
The bridge uses explicit host/project flags; it fetches compact issue details
without personal breakdowns. A fix thread may retrieve a representative exception
using existing access when necessary. Desktop content-free diagnostics may be
insufficient; fix threads are authorized to expand application instrumentation and
the existing PostHog setup within existing access and budgets, preserving consent
and privacy. Prefer bounded, content-free diagnostics and verify safely with
synthetic inputs. Report what remains unknown and what the next occurrence will
reveal; additional telemetry alone does not establish a fix. The immutable launch
payload persists privately in SQLite and T3; do not publish private diagnostic data.
Prompt and model/permission changes apply after deploying and restarting the
service, only to jobs not yet reserved. Existing persisted launches retain their
exact original payloads on retry.

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

One service process owns each queue through a crash-released SQLite lock.
Each new PostHog issue gets a repair thread and worktree. Repeated notifications
for the same issue reuse its durable record. Waiting and unsettled threads
continue to be checked for completion while the fixer starts other issues.
T3 settlement with all runs terminal completes the corresponding queue entry.
Existing repository delivery gates still apply. Different issues can affect the
same code, so each repair must reconcile with current main before merge.

The UTC daily cap counts durable launch reservations, including uncertain launches.
After an RPC failure the service retries the exact persisted command, thread ID
and prompt, at most three attempts with one-minute backoff. It then holds that
issue for operator reconciliation. Context-read failures retry separately.
Unknown or malformed T3 status preserves the affected issue's state. Queue identity is bound to both origins and both projects; changing
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

## Issue lifecycle

Fix threads reuse matching GitHub issues or create one through PostHog's existing
GitHub integration, which creates and links in one operation. It cannot attach
existing GitHub issues; those use reciprocal description/body links. Reconcile
uncertain creates before retrying. Keep public issue text sanitized.

PostHog has no in-progress status: use active with an In progress description
note and GitHub URL, preserving human decisions. Resolve only delivered, verified
repairs. Diagnostics-only work stays active. Report missing error_tracking:write
access without broadening credentials. Creation happens on fix admission;
immediate creation for every queued issue would need separate durable handling.

## Private desktop recordings

Configure these three absolute paths together to accept recorded desktop
reports: `SUPPORT_REPORT_EXECUTABLE` (installed Apparent with the support
archive reader), `SUPPORT_REPORT_TOKEN_FILE` (Connect support read token) and
`SUPPORT_REPORT_KEY_FILE` (the dedicated age identity). Both credential files
must be private and owned by the fixer service account. Do not store either
credential in PostHog or the T3 thread.

Use the shipped system-level service and socket units for recorded reports.
The service runs as `apparent-fixer` with `PrivateTmp=true`, private queue
state, and scoped T3 and PostHog credentials. The system socket owns
`/run/apparent-posthog-support.sock`. Enable both units for the webhook and
download listeners. The fixer refuses support configuration without the
inherited, root-owned Unix socket. Keep the installed Apparent reader and its
parent directories outside the agent's write access. The reader uses
`/usr/bin/tar` on the fixer host.

Run the T3 coding agent on the same host under a different unprivileged account
without access to fixer state and credentials or a way to assume its identity.
Set `SUPPORT_REPORT_AGENT_UID` to that account's UID. The native reader checks
the kernel-provided Unix peer UID before fetching or decrypting any data. The
fixer refuses its own UID and UID 0. The webhook's TCP listener cannot serve
recordings. Do not forward the Unix socket through the webhook proxy.

The fixer gives each job a random bearer to request its own report over the
Unix socket. Downloads decrypt on demand and remove the fixer's temporary
plaintext before returning the archive. The agent extracts the tar in a
private temporary directory and removes its copy after inspection. The grant
allows up to three attempts, expires within seven days, and is revoked on job
settlement. Retrieval failures can be retried within that bound. No recording
is stored in the T3 attachment vault or the launch payload.
