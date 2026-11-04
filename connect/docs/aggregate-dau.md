# Aggregate Connect daily activity — candidate, production HOLD

This is the bounded implementation of server-side daily totals, **not** default-on
account-linked PostHog events. Existing individual PostHog consent, choices, UUIDs,
outbox and delivery remain unchanged. No production migration, deployment,
connector allowlist change or trial is authorized by this document. The controller
assessment below and independent privacy/technical review must be resolved first.
There is no hidden experiment flag: applying 0009 and deploying the code is the
processing boundary and must not occur while this hold is active.

## Producer contract

Only `reporting_daily_active_accounts` may be synced by the existing D1 connector:

| Column | Value |
|---|---|
| `day_utc` | TEXT `YYYY-MM-DD`, original successful server-action UTC day |
| `active_accounts` | nonnegative INTEGER; **observed distinct-account lower bound**, not an exact census |
| `as_of_ms` | INTEGER, coarse global successful maintenance watermark, not an individual's action time |
| `collection_started_at_ms` | INTEGER, immutable actual 0009 application boundary |
| `coverage` | TEXT, always `observed_lower_bound` |

**This coverage qualification is necessary, not cosmetic.** Exact atomicity with
primary writes would let metric failures break uploads/shares. Instead the actual
successful transition schedules a separate caught D1 write with `waitUntil`.
Crashes, missing/failed schema, queue/cap/worker failure may lose admissions without
a reliable missed-event count. Even a healthy heartbeat cannot prove otherwise.
The implementation never certifies complete coverage and never exports a zero:
missing days, failed reads and zero observed admissions are **unknown**, not true
zero. Consumers must not zero-fill these gaps. First/current days are also partial;
identify the first from `collection_started_at_ms`, the current from UTC today.
If an exact census/true zero is mandatory, this candidate does not meet that demand;
the availability-versus-exactness decision must be resolved rather than hidden.

Successful `pending`→`ready` upload completion after object verification and first
durable share insertion qualify. SQL `RETURNING` identifies the actual winning
mutation; repeat requests do not re-admit an older action on a later day. The
completion time is produced inside that SQL statement; share creation uses its
original server-created `created_at`. A pending share counts creation, not watch
readiness. No signup, login, device approval, storage/background snapshot, local-only
recording, historical census or event backfill qualifies. One atomic metric-local
INSERT/trigger increments only for the first account/day; concurrent upload/share
admissions deduplicate together. None of these metric triggers attaches to product,
auth or existing consent tables, so a metric failure cannot roll back those writes.

No identity, pseudonym, event UUID, capture/share ID, individual event timestamp,
email, IP, path, recording or arbitrary properties appears in the exported view.
`as_of_ms` advances on global scheduled maintenance, not individual activity.
All four new internal tables and other raw tables must remain disabled for PostHog;
keep auto-sync-new false and direct query false. The reporting owner alone changes
the existing source/view allowlist, same board/top chart and its coverage labels.
The existing two aggregate views and storage/distribution reports are untouched.

## Internal data and retention

- `aggregate_dau_dedup`: original opaque **account ID** + UTC day + common expiry
  (`day end + 1 hour`). This is honest pseudonymous personal data, not anonymization;
  no extra hashing/rotation/identity service. Maximum logical lifetime is 25 hours.
- The separate objection bit remains with the existing account preference until
  account erasure; it is not event attribution and must not expire with dedup.
- Admission rejects expired original days, future timestamps, actions before actual
  start, absent accounts, reserved `.invalid` fixture addresses, pre-registered exact
  fixture exclusions, and an existing choice/tombstone without current affirmative
  consent. An additive `analytics_choices.aggregate_objected` bit preserves an
  aggregate objection even when individual PostHog consent is later granted.
  Existing refusal revisions/times and individual consent are not rewritten.
- Existing refusals/withdrawals block future admissions in the same D1 statement.
  `DNT:1`/`Sec-GPC:1` suppress the applicable request; an unflagged retry of that same
  already-completed action does not count it later. No inference is made that an
  unobserved device/browser sent a signal. Account-wide saved objections remain the
  existing preference; no new browser tracking or identity linkage is introduced.
- The metric table cap is 10,000 dedup rows. Overflow is an unmeasured loss, not zero
  and not a product error. No new R2 operations or budget writes occur.
- Normal 15-minute scheduled maintenance deletes expired dedup rows, reconciles
  saved objections/exclusions/account erasure, and removes aggregate days before
  the rolling 30-calendar-day window. It runs independently of legacy cleanup;
  the existing cleanup→individual-export order is preserved.
- Attribution expiry does **not** decrement historical totals. While an attribution
  row still exists, objection/account deletion removes its contribution when
  maintenance next succeeds, even if cleanup was late. Once attribution is forgotten,
  this implementation cannot locate or subtract one account from a retained total.
  Counter zero after a correction is not published as a verified zero.
- Physical removal is by the next **successful** maintenance run: ordinarily within
  15 minutes after logical expiry, not a guarantee during outages. Existing D1 backup/
  Time Travel copies can retain data separately; their actual window and lawful
  erasure handling must be included in the deployment assessment. No all-copy 25-hour
  deletion promise is made. PostHog and its backups retain synced totals under its
  existing settings; removing a D1 row is not proof of remote physical deletion.
- Fixture exclusions are exact account IDs, registered **before** any test action,
  plus the reserved `.invalid` address safeguard. Unexpired exclusions survive before
  the synthetic account exists; expired exclusions for absent accounts are removed.
  Never rely on provider-side identity exclusion to repair a polluted aggregate.

## Concrete purpose / necessity / balancing assessment candidate

Controller/contact: Simon van Laak, `simon@tryapparent.com`. Proposed purpose is to
understand daily use of successful hosted handoff, so that reliability and product
investment can be assessed, without sending account events to a third party unless
that account separately opted in. Proposed, **not approved**, basis is GDPR6(1)(f)
for this separate internal operational-statistics processing. Product authorization
and pseudonymization do not establish lawfulness.

Data flow: existing authenticated upload/share authorization resolves the account
inside the Worker. Only the winning service action passes its already-known opaque
ID and server time to the internal counter. D1 transiently reads the existing email
only for the `.invalid` fixture exclusion; neither that email nor the action time is
stored in dedup. D1 keeps account/day until the short attribution expiry; the existing
connector can read only the day/total/coverage view. Individual opt-in event export
remains separate. There is no new SDK, browser event, client cookie, local-storage key,
replay, cross-device link, export service, access grant or purchase.

Necessity: distinct account/day counting requires temporary equality testing; pure
request totals cannot deduplicate retries or multiple actions. Reusing the existing
opaque account ID avoids additional fingerprinting/identifiers. The 25-hour logical
window permits UTC rollover and one-hour late scheduling without counting an old
retry twice after forgetting. Longer account-level histories, action IDs, per-action
journals, content and individual provider events are unnecessary for this purpose.
Alternatives considered: existing affirmative event DAU has consent-limited coverage;
request totals measure volume, not distinct accounts; primary-transaction counting
would violate the required fail-open service behavior. None grants blanket authority
to override a refusal. The lower-bound compromise requires explicit product review.

Balancing concerns: accounts may not reasonably expect new nonconsented processing,
even on our own server; stable IDs remain personal data. A tiny beta cohort means a
daily total of one may reveal a known person's use. Exact totals and consecutive-day
patterns are **not certified anonymous** just because identity columns are absent.
The candidate does not invent a k-anonymity guarantee. Controller/privacy review must
choose whether this small-cohort disclosure is permissible or requires suppression,
bucketing, a minimum cohort or no third-party export; no such policy is assumed.
Mitigations implemented: bounded attribution, prospective-only start, no event history,
refusal/signal exclusions, exact fixture isolation, minimal provider view, coarse
watermark, no true-zero/full-coverage claim, retained provider protections, and an
always-available objection control. These reduce risk but do not complete balancing.

Terminal/credential purpose audit: upload/read tokens in the existing client's private
`hosted/*.credential` files, Google/browser session cookies and device grants support
requested authentication/upload/read access. This counter neither reads those files
nor creates or refreshes a credential; it receives the account already established
for the requested service. Nevertheless, reusing an identity for a further statistics
purpose requires an actual German TDDDG25 purpose assessment; no inference that all
credential storage becomes necessary for analytics is permitted. No new device-data
access is requested. This audit must be checked against actual installed client and
cookie behavior, not treated as legal clearance from a source-code assertion.

Authorities to assess: [TDDDG25](https://www.gesetze-im-internet.de/ttdsg/__25.html),
[GDPR6/13/21](https://eur-lex.europa.eu/eli/reg/2016/679/ojv),
[Baden-Württemberg FAQ3.1](https://www.baden-wuerttemberg.datenschutz.de/faq-zu-cookies-und-tracking-2/),
[EDPB consent05/2020 ¶121–123](https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf).
The cited EDPB legitimate-interest1/2024 consultation material and Council2026
negotiating proposals must not be described as final/operative permission.

## Prospective notice and release gate

The candidate account notice visibly separates these service totals from individual
consent, explains the attribution window, lower-bound/inference limitations and
objection. The existing Stop action remains available even with no saved choice;
it records the existing false preference and stops individual export as before.
A no-choice account is not marked consented. Existing true/false records are not
rewritten. Individual re-consent does not cancel the separate aggregate objection;
the candidate has no automatic objection-reset control. The expanded notice is a
draft until reviewed with this assessment.

Before any production migration/code activation, the controller must approve the
actual purpose/basis, terminal-purpose assessment, small-cohort policy, lower-bound
rather than census contract, retention/backup/erasure limitations, and notice delivery
and effective UTC boundary. Publish the approved notice **before** that boundary;
apply 0009 no earlier than it. Its actual SQL time is the reporting start. Do not
silently infer that prior service users saw a new notice. If advance notice or further
user action is required, implement that reviewed rule first; no product request
waives it. No production fixture or new data processing occurs while unresolved.

After approval: independent candidate review and focused/full affected checks; exact
current-main Linux release admission; backup and checked additive schema application;
verified source deployment; pre-register exact synthetic exclusions before any trial;
read back aggregation/TTL/refusal/failure behavior; only the consumer owner enables
this exact view and verifies first sync. No dashboard/source credential changes by
this producer. Keep the existing opt-in stream until the consumer accepts replacement
coverage. Existing provider-erasure work is separate and must not be resubmitted.

Rollback: leave the original individual collector/choices and existing views intact;
stop the new queue calls by deploying the prior compatible Worker, then expire and
remove only the new metric state under an explicit reviewed cleanup. Never restore
old usage/budget counters or pretend an already-synced total was erased remotely.
