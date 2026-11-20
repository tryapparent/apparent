# Connect upload cadence

The two additional payloads show **Uploads per active account · today** and
**Uploads per active account over time**. Place them on a new row below the
activity chart, with three of twelve columns for the number and nine for the
trend. Stack the number above the trend on narrow screens.

Each UTC day's value divides observed completed Connect uploads by the number of
distinct Connect accounts observed completing an upload or creating a share
that day. Multiple completed uploads by one account count separately. Upload
completion retries, shares and local-only recordings do not add to the
numerator. A day with only observed shares shows zero. A day without qualifying
observations shows a gap, including all days before rollout. Current-day counts
are partial and the same consent, fixture exclusions and fail-open collection
limits apply as for the activity chart. Observation writes that arrive after
their action's UTC day ends are dropped.

Migration `0015.sql` keeps a count and latest UTC observation date on the
existing pseudonymous Connect activity subject. A new day resets the count on
the next qualifying action. Existing withdrawal and seven-day cleanup remove
the subject and its count. The same snapshot stores the matched totals for 30
days and exports only those totals and the date via
`reporting_connect_upload_cadence`.

Verify the updated Connect activity notice is live before applying the separately
authorized D1 migration. After deployment, verify an
eligible upload in the aggregate and enable a full refresh of only
`reporting_connect_upload_cadence` in the existing PostHog source. Verify the
imported date and both counts before adding the tiles. To roll back, remove the
two tiles and disable that view's sync. The existing activity insights use their
original view.
