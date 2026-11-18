const history = 'cloudflared1.apparent_ops.reporting_product_activity_history';

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

process.stdout.write(JSON.stringify([...metricInsights, chart], null, 2) + '\n');
