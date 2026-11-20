# Product activity dashboard

The existing PostHog dashboard separates account activity from browser visitors
and current recording/storage inventory. Its Connect daily chart reads
`reporting_daily_active_accounts`; it must not return placeholder NULL values once
the table is available. Use `{filters(timestamp AS timestamp)}` on the calendar
query so the date picker filters its observed history. Blank days stay unknown,
not zero. The existing daily collector retains thirty days of aggregate totals.

The active-account summary shows Desktop and Connect separately. DAU means today
UTC; WAU means today and six preceding UTC dates, deduplicated across the whole
window. Inventory snapshots, browser pageviews, logins and technical error reports
cannot substitute for either product's qualifying activity. Label missing sources
explicitly until deployment and a real aggregate import are verified. Collection
starts prospectively; first-day and first-week coverage are partial.

The old offline `connect/service/scripts/usage-dashboard.mjs` plan remains a
separate legacy event view. It counts optional account-created/device-connected/
upload events and pageview identities, not the new aggregate DAU/WAU. A zero there
means no matching opted-in events; it does not establish zero product activity.
Its source-only tests establish payload shape, not deployment or live coverage.

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

## Combined daily and weekly activity

Migration `0013.sql` adds a 30-day aggregate history. The existing Worker cron
takes each day's latest successful UTC snapshot. The Desktop total counts the
union of eligible accounts with a confirmed Desktop recording start or a
successful Connect upload/share. Connect counts the second group alone. The
same union and subset apply independently to the trailing seven UTC dates.
The Worker pairs existing product subjects transiently for the aggregate query.
The view exposes only four counts, the UTC date and the snapshot timestamp. A
missed collection or the period after the day's final snapshot can undercount.
History starts at rollout and has no backfill.

Apply the additive migration through the authorized D1 migration procedure and
verify the deployed Worker's next scheduled snapshot. In the existing PostHog D1
source, discover and enable only the `reporting_product_activity_history` view as
a full refresh. This propagates the 30-day retention and replaces updated counts
for the current day. Validate the imported columns and timestamp before changing
the dashboard.

Run `node connect/enablement/activity-dashboard.ts` for PostHog payloads. Put
four numbers in a row, then the full-width chart. See [upload cadence](../enablement/activity-dashboard/README.md).
Clear
the previous activity table, daily chart and explanatory tile from the dashboard
after verifying the replacement tiles. To roll back the presentation, restore
the previous tile references from the dashboard backup and disable the new view
sync if the aggregate feed is being rolled back.
