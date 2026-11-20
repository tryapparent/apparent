const history = 'cloudflared1.apparent_ops.reporting_product_activity_history';
const uploadCadence = 'cloudflared1.apparent_ops.reporting_connect_upload_cadence';

const metrics = [
  ['Desktop · today', 'desktop_daily'],
  ['Connect · today', 'connect_daily'],
  ['Desktop · last 7 days', 'desktop_weekly'],
  ['Connect · last 7 days', 'connect_weekly'],
] as const;

const metricInsights = metrics.map(([name, column]) => ({
  name,
  description: 'Current UTC window. A dash means the aggregate is unknown.',
  query: {
    kind: 'DataVisualizationNode',
    display: 'BoldNumber',
    source: {
      kind: 'HogQLQuery',
      query: `SELECT coalesce(toString(nullIf(max(toInt64OrNull(toString(${column}))), 0)), '—') AS accounts
FROM ${history}
WHERE day_utc = toString(toDate(toTimeZone(now(), 'UTC')))`,
    },
  },
}));

const series = [
  ['connect_daily', 'Connect · daily', 'bar', '#2563eb'],
  ['desktop_only_daily', 'Desktop only · daily', 'bar', '#94a3b8'],
  ['desktop_weekly', 'Desktop total · weekly', 'line', '#64748b'],
  ['connect_weekly', 'Connect · weekly', 'line', '#2563eb'],
] as const;

const chart = {
  name: 'Active accounts over time',
  description: 'The full bar includes Connect. Weekly lines count distinct accounts over seven UTC dates. Gaps indicate unknown counts.',
  query: {
    kind: 'DataVisualizationNode',
    display: 'ActionsStackedBar',
    source: {
      kind: 'HogQLQuery',
      filters: { dateRange: { date_from: '-30d' } },
      query: `SELECT timestamp, connect_daily, desktop_daily - connect_daily AS desktop_only_daily,
 desktop_weekly, connect_weekly
FROM (
 SELECT days.timestamp AS timestamp,
  nullIf(toInt64OrNull(toString(activity.desktop_daily)), 0) AS desktop_daily,
  nullIf(toInt64OrNull(toString(activity.connect_daily)), 0) AS connect_daily,
  nullIf(toInt64OrNull(toString(activity.desktop_weekly)), 0) AS desktop_weekly,
  nullIf(toInt64OrNull(toString(activity.connect_weekly)), 0) AS connect_weekly
 FROM (
  SELECT subtractDays(toStartOfDay(toTimeZone(now(), 'UTC')), age) AS timestamp
  FROM (SELECT arrayJoin(range(30)) AS age)
 ) AS days
 LEFT JOIN ${history} AS activity ON toString(toDate(days.timestamp)) = activity.day_utc
)
WHERE {filters(timestamp AS timestamp)}
ORDER BY timestamp`,
    },
    chartSettings: {
      xAxis: { column: 'timestamp' },
      xAxisLabel: 'UTC day',
      leftYAxisSettings: { label: 'Accounts', startAtZero: true },
      showLegend: true,
      showNullsAsZero: false,
      yAxis: series.map(([column, label, displayType, color]) => ({
        column,
        settings: { display: { label, displayType, color }, formatting: { decimalPlaces: 0 } },
      })),
    },
  },
};

const uploadsPerAccount = 'round(toFloat64OrNull(toString(completed_uploads)) / nullIf(toFloat64OrNull(toString(active_accounts)), 0), 2)';
const cadenceDescription = 'Completed Connect uploads divided by active Connect accounts observed by the same collector. Uploads and new shares qualify as activity.';

const cadenceNumber = {
  name: 'Uploads per active account · today',
  description: `${cadenceDescription} Today in UTC. A dash means coverage is unknown.`,
  query: {
    kind: 'DataVisualizationNode',
    display: 'BoldNumber',
    source: {
      kind: 'HogQLQuery',
      query: `SELECT coalesce(toString(max(${uploadsPerAccount})), '—') AS uploads_per_account
FROM ${uploadCadence}
WHERE day_utc = toString(toDate(toTimeZone(now(), 'UTC')))`,
    },
  },
};

const cadenceChart = {
  name: 'Uploads per active account over time',
  description: `${cadenceDescription} The current UTC day is partial. Gaps indicate unknown coverage.`,
  query: {
    kind: 'DataVisualizationNode',
    display: 'ActionsLineGraph',
    source: {
      kind: 'HogQLQuery',
      filters: { dateRange: { date_from: '-30d' } },
      query: `SELECT timestamp, ${uploadsPerAccount} AS uploads_per_account
FROM (
 SELECT subtractDays(toStartOfDay(toTimeZone(now(), 'UTC')), age) AS timestamp
 FROM (SELECT arrayJoin(range(30)) AS age)
) AS days
LEFT JOIN ${uploadCadence} AS cadence ON toString(toDate(days.timestamp)) = cadence.day_utc
WHERE {filters(timestamp AS timestamp)}
ORDER BY timestamp`,
    },
    chartSettings: {
      xAxis: { column: 'timestamp' },
      xAxisLabel: 'UTC day',
      leftYAxisSettings: { label: 'Uploads per account', startAtZero: true },
      showLegend: false,
      showNullsAsZero: false,
      yAxis: [{
        column: 'uploads_per_account',
        settings: {
          display: { label: 'Uploads per active account', displayType: 'line', color: '#2563eb' },
          formatting: { decimalPlaces: 2 },
        },
      }],
    },
  },
};

process.stdout.write(JSON.stringify([...metricInsights, chart, cadenceNumber, cadenceChart], null, 2) + '\n');
