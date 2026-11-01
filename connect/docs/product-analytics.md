# Optional product analytics

Implementation candidate for #175's later PostHog scope, not deployment approval. PostHog explains conversion and repeat use; Connect's D1/R2 ledger remains authoritative for admission, storage and spending. The original issue also asks for Cloudflare operations and agent/share retrieval analytics; this slice does not implement those views.

## Measurement contract

| Event | Authoritative transition / meaning |
| --- | --- |
| `$pageview` | Consenting browser loads `/`, `/connect`, `/connect/device`, `/connect/shares` or their `/hosted` aliases. `page` is the fixed route, never the URL. Connect waits for session resolution before recording it. |
| `app_download_clicked` | Browser clicks a GitHub release/installer link. **Intent, not a completed download or installation.** |
| `connect_account_created` | D1 inserts an account after collection is enabled. Not every login; existing accounts are not backfilled as new. |
| `connect_device_connected` | D1 changes a device from pending to approved. Retries do not create another approval event. |
| `connect_upload_completed` | D1 changes a capture from pending to ready after complete-object verification. Repeated or concurrent completion counts once. `recording_bytes` is the manifest total. |
| `connect_storage_snapshot` | Once per UTC day per account, at the first successful scheduled sweep. A gauge, not an increment. |

Server identities are `account:` plus the existing opaque 64-hex account ID; these are pseudonymous identifiers, not anonymous people. Server actors are browser (signup/approval), device (upload) and system (snapshot). No successful agent-retrieval or share-open event exists in this slice. Every event carries an explicit production, synthetic or development environment. Every server transition, snapshot and session identity requires a separate, current per-account pilot opt-in. Operator exclusions additionally apply before server export and session identity exposure.

Storage snapshot fields:
- `retained_bytes` / `retained_recordings`: ready, unexpired captures only.
- `pending_reserved_bytes`: unexpired pending manifests whose incomplete-upload deadline has not passed.
- `physical_reserved_bytes`: unreleased attempt reservations, including in-flight, duplicate, uncertain and orphan attempts. This is **not measured R2 object size**. Logical deletion does not necessarily release it.
- There is no independent pending-cleanup byte measurement yet. Subtracting logical bytes from physical reservations is not an exact cleanup backlog; unknown/in-flight attempts prevent that interpretation.

## Reporting definitions

Use UTC and filter every view to one environment. An upload-active account completes at least one new upload, not a poll, login, retry, asset GET or snapshot. Daily means the calendar UTC day; rolling seven/thirty means distinct accounts in the entire preceding seven/thirty-day window. Never sum daily distinct counts. Calendar weekly/monthly are different measures and must be labelled separately.

Use two separate funnels: (1) consenting browser visit → download intent, and (2) new account → approved device → first completed upload, with a 30-day conversion window. The account funnel covers only accounts explicitly enrolled before signup; enrolling an existing account does not invent its signup event. Do not require every signup to have clicked a download. A marketing-to-account funnel covers only browsers that affirmatively allow identity linkage and accounts enrolled in the separate server pilot, on the same origin/browser storage. It is not all-visitor conversion. The alternate hosted origin does not share local storage.

Activation is the first observed completed upload after collection begins. Signup cohorts use account-created → subsequent completed upload; activation cohorts use first completed upload → later completed uploads. Use noncumulative weekly retention, and distinguish an unelapsed interval or missing history from zero. Existing accounts' actual first-ever upload dates are unknown without an explicitly reviewed historical migration.

Recording-size mean and median apply to completed-upload `recording_bytes` in the chosen window. Uploaded cumulative bytes are a sum over completed-upload events, not retained storage. For current per-account storage and its mean/median, select the latest snapshot per account first, then aggregate; do not add daily snapshots. Show snapshot freshness and include zero-storage accounts. No live/synthetic PostHog query or rendered dashboard is verified by local event-emission tests alone.

## Privacy and control

The browser client is inert until enabled at build time and until an affirmative choice. It does not load an SDK, autocapture, replay, console/error capture or third-party resources. It suppresses collection for GPC/DNT and unavailable storage. No code runs on capability-link routes; never include this overlay in the service's `/s/…` responses. `/connect/shares` is an authenticated management route, not a public recording page.

Only fixed route/platform fields and allowlisted acquisition source/medium values are sent. Unknown attribution values become `other` or `unspecified`. The client never forwards raw referrers, URL/query/fragment, DOM text, recording content, titles, filenames, email, session fields or capability links. Requests omit credentials and referrers; geolocation enrichment is disabled. The analytics provider still receives the network connection/IP and browser transport metadata; application payload suppression is not network anonymity.

The choice lasts 180 days from the explicit decision; session/identity refresh does not renew it. Analytics settings allow withdrawal. Another tab's choice change suppresses this tab until reloaded or explicitly opted in. Account changes rotate anonymous identity to prevent merging different accounts; Connect resolves the session before emitting its pageview. Withdrawal stops future browser events, not deletion of already collected events or server-side account analytics. Server collection has a separate operator enablement/disclosure requirement; browser permission must not be described as controlling it.

Before enabling, approve privacy disclosures and the lawful basis for server collection, project membership, retention, deletion handling, internal-account exclusions and cost limits. Restrict access to the analytics operators; do not publish/share the account-level dashboard. No deletion automation or verified provider retention/billing policy is included. Account erasure must remove its outbox rows and provider identity/history through the approved operator process. Exclusion stops future export, not historical provider data.

### Separate account pilot opt-in

The operator-managed `analytics_consent` ledger records an affirmative account choice independently of the website's browser choice. It starts empty. There is no self-service account-consent endpoint or UI in this slice. Before any enrolment, the operator must obtain the participant's explicit approval for the disclosed server pilot and retain the approval evidence privately; signup, login, uploading, browser consent and an operator's guess are not approval. No consent writes or real collection are authorized by this implementation.

For an approved pilot, insert only the exact opaque `account_id` and actual decision time `consented_at` (positive integer UTC milliseconds). Let D1 generate `consent_id`; it identifies this enrolment, not a provider identity. No email or recording data belongs in the ledger. A reviewed pre-enrolment can precede account creation, so the ledger deliberately has no account foreign key. If the exact opaque identity cannot be established before signup, enrol the existing account instead and leave its signup cohort unknown. Never backdate a decision or backfill events. Future decisions authorize nothing until their time is reached. Current storage gauges may include still-retained recordings created before enrolment; they are not historical upload events.

Withdrawal deletes that account's consent row. Its delete trigger purges pending outbox rows in the same operation; future transitions and snapshots are not collected and session requests authorized afterward expose no analytics identity. To record a new choice, delete then insert; in-place updates are rejected. The new consent identity prevents stale queue restores, unapproved prepared events or old acknowledgements from inheriting later permission.

The final database eligibility check, after asynchronous payload preparation, is the export authorization cut-off. Withdrawal blocks new export authorizations, but a batch already authorized may still be sent and finish after withdrawal—even if the database answer has not yet reached the Worker or its network request has not started. Each concurrent exporter admitted before withdrawal may finish its batch; there is no system-wide one-batch guarantee. This also applies to global disable. A prepared payload that has not passed this final check is not authorized. Later sweeps cannot retry withdrawn rows. Withdrawal does not erase provider history; deletion of provider history remains a separate approved process. An already-open browser also retains its independent browser choice; account withdrawal does not impersonate browser withdrawal.

Global collection and valid runtime delivery configuration remain separate prerequisites. Account opt-in alone does not enable collection, and browser withdrawal alone does not delete the account opt-in. Snapshot scheduling remains daily UTC: an account enrolled after that day's sweep first gets a gauge on a later day's successful sweep, not a backdated one.

## Rollout and rollback

No production resource, credential, logging switch or application deployment is changed by this code. The observed PostHog project is EU-hosted and had received no events at inspection. No dashboard can yet be credited as validated against collected data.

1. Review the exact Cloudflare account/routes and EU PostHog project; confirm Free/paid limits, ingestion retention and cost controls. Existing deployment templates are not evidence of production state. Keep platform request logging disabled until capability-URL leakage is ruled out.
2. Apply additive `connect/service/migrations/0004.sql` then `0005.sql` with the normal D1 migration tooling after preceding migrations, before any enablement. `0005` disables global collection, discards legacy unapproved analytics outbox rows and starts an empty per-account consent ledger. It does not change product data or the storage budget. Do not seed account history. Without `0005`, the new runtime refuses identity/export but legacy triggers still exist; never enable the old schema's global collection switch.
3. Configure the Worker bindings `POSTHOG_ENABLED`, `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST=https://eu.i.posthog.com`, `POSTHOG_ENVIRONMENT` and optional comma-separated `POSTHOG_EXCLUDED_ACCOUNT_IDS`. Supply credentials through the deployment secret mechanism, never repository source or logs.
4. Server export requires `POSTHOG_ENABLED="true"` with complete valid runtime config, `UPDATE analytics_control SET enabled=1 WHERE id=1`, **and** the account's explicit pilot opt-in. The DB flag plus account opt-in starts outbox collection even when runtime delivery is off. With an empty consent ledger no account is collected, even with the DB flag on. Enable only after the review above and enrol only approved participants.
5. Browser builds require `PUBLIC_POSTHOG_ENABLED="true"`, `PUBLIC_POSTHOG_PROJECT_TOKEN`, `PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`, and `PUBLIC_POSTHOG_ENVIRONMENT`. These are compile-time values; rebuild **both** Connect and the Pages homepage composition. The project ingestion token is public in enabled assets, never a personal/OAuth token. Do not enable previews with production attribution. Default-off assets contain no configured provider token.
6. Validate two synthetic accounts and collected charts before production. Check deduplication, actor/environment filtering, acquisition, consent, excluded accounts, retained/physical gauges and outage retry. Use synthetic recordings only. No real recording upload is required.
7. To stop new server collection/export set the DB row to disabled and runtime enablement false. Delete queued rows only under an explicit retention/erasure decision. Rebuild/redeploy browser assets with public enablement false to remove the overlay. This does not erase existing provider history.

Triggers enqueue within the product transaction, without provider I/O. The outbox is bounded to 10,000 rows; overflow increments `analytics_control.dropped` rather than rejecting normal product actions. Queue entries older than 90 days expire during delivery. Scheduled export sends at most 100 oldest rows per sweep with a five-second timeout, fixed EU destination, no redirects, deterministic event UUIDs and unchanged timestamps on retries. Ambiguous/failed acknowledgements retain rows. Cron cadence limits throughput; do not enable above that delivery capacity. `collection_dropped>0` means event totals are incomplete, not exact accounting. Monitor the DB counter even when the provider is unreachable.

## Local verification

Run CPU-heavy checks once through `/home/simon/.local/bin/t3-build` on Clanker:
- `cd connect/service && npm test`: real workerd/D1/R2 lifecycle tests with a synthetic outbound provider.
- `cd connect/web && npm test`: production build, artifact ownership, routes and existing synthetic browser cases.
- `node --test public/site/scripts/pages/test-pages-package.mjs`: default-off canonical bytes, enabled overlay and invalid-config refusal.
- Build Connect with the four public analytics variables set to synthetic configuration and `CONNECT_BUILD_DIR=dist-analytics-test`, then run `cd connect/web && node test/analytics.browser.mjs`. It uses the repository's Chromium fixture, intercepts all nonlocal traffic and writes screenshots only under private scratch.

These checks do not prove live OAuth, actual ingestion, rendered PostHog charts, native macOS/Linux integration, production hosting, plan costs or deployment. No desktop capture behavior changes in this slice.
