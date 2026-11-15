# Visitors and Connect actions

Issue #356: signing into Connect does not populate the starter dashboard's
pageview-based “Active users”. Main has no product-usage collector; the optional,
consent-gated implementation remains in draft PR #269. Neither a login nor a
zero-valued query establishes collection coverage.

From `connect/service`, run `node scripts/usage-dashboard.mjs` to print an offline
PostHog plan. It contains a new private dashboard, a mandatory coverage text tile
and four separate insight payloads. It reads no credentials, changes no provider
settings and sends no events. Validate with
`node --test test/analytics/dashboard.test.mjs`.

An operator with approved project write access can create the dashboard and
insights, then attach the notice and insight tiles using the provider's supported
API. Discover current tool schemas first; the JSON is a plan, not a bulk API
request. Do not modify the existing starter dashboard or its shared insights.
Keep the coverage notice visible. Read back private visibility, queries and all
rendered tiles before claiming the dashboard is installed. Rollback deletes only
the newly created dashboard/insights identified in that operator's receipt.

The queries require `environment = production`, deliberately excluding synthetic,
development and unclassified legacy events. The browser number counts distinct
pageview identities. The account numbers count distinct pseudonymous account
identities across each entire rolling UTC window (24 hours, seven days, 30 days),
with account creation, first explicit device connection or completed upload.
They do not sum daily counts. Duplicate delivery does not increase distinct
identity counts. Snapshots do not establish human activity. Login-only activity
is not measured by #269 and must not be claimed here.

This plan is independently usable on main, but useful production values depend
on #269's consent, migration, deployment and activation gates. Implementing this
plan does not authorize those operations or provider settings changes. Before
removing the unverified-coverage notice, verify the exact project, deployed event
sources, production marker, collection start date and opted-in coverage. Confirm
eligible actions arrive and opted-out actions do not; browser pageviews and
account events remain separate. Retain limitations for incomplete history and
consent coverage. No GUI, live ingestion or complete-user census is proved by
local plan tests.

## Signed-in product activity

Migration 0012 starts prospective Desktop/Connect DAU and WAU. Google sign-in
continues to resolve the existing internal account; activity storage instead uses
an HMAC-SHA256 subject domain-separated by product and purpose, keyed with the
existing service authentication secret. No email, Google subject, raw account ID,
recording ID, device ID or content is stored in `product_activity`. This is
pseudonymization: the service can derive a subject to honor privacy choices. A
secret rotation changes subjects, so clear this disposable table during a planned
rotation before collecting again to prevent duplicate counts.

The authenticated Desktop endpoint accepts only an empty object. The packaged
TypeScript policy admits connected, confirmed recording starts, excluding practice;
native adapters retain credentials and transport. Failed/pending starts, lab,
signed-out use and polling do not count. Observation runs off the capture thread,
with one bounded in-flight worker, no spool or metric retry. Missing modules or
network/service failure leave recording untouched and can undercount. Linux uses
the first real frame; phone capture uses the helper's recording acknowledgement.

Connect admissions use the same completed-upload/new-share successes as the
existing daily collector. A subject stores only its latest UTC date. Logical
expiry is seven days from that date's beginning; cron removes it. DAU means today
UTC; WAU means today plus six preceding UTC dates, counted once per account and
product. Only `reporting_product_activity` may be enabled in the warehouse: two
aggregate rows with source/start times. Do not sync the subject table. Historical
weekly metrics cannot be reconstructed from this latest-date table or old daily
totals. The existing 30-day Connect DAU series remains separate.

The current kill switch, account refusals, aggregate objection, fixture exclusions,
GPC/DNT and account deletion still apply. Withdrawal removes latest-date subjects;
cron retries and reconciles remaining eligibility without storing a reverse lookup.
Counts are permanently observed lower bounds; missing observations stay unknown.
No data is backfilled from current storage or login records. Roll back the new
caller and endpoint together; leaving the additive schema in place preserves the
legacy daily collector. Remove subjects on rollback; removal of legacy DAU is
not part of this change. Dashboard integration requires deployment of the notice,
migration, endpoint, packaged Desktop caller and a successful aggregate import.
