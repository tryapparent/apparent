import fs from 'node:fs/promises';
export const analyticsTag = '<script type="module" src="/assets/product-analytics.js"></script>';
export function analyticsConfig(env = process.env) {
  if (env.PUBLIC_POSTHOG_ENABLED !== 'true') return null;
  const config = {enabled: true, token: env.PUBLIC_POSTHOG_PROJECT_TOKEN, host: env.PUBLIC_POSTHOG_HOST, environment: env.PUBLIC_POSTHOG_ENVIRONMENT};
  if (!/^phc_[a-zA-Z0-9_]+$/.test(config.token || '') || config.host !== 'https://eu.i.posthog.com' || !['production', 'synthetic', 'development'].includes(config.environment)) throw new Error('Invalid explicit product analytics configuration');
  return config;
}
export function analyticsHomepage(html, config) {
  if (!config) return html;
  if (!html.includes('</head>') || html.includes(analyticsTag)) throw new Error('Unexpected analytics overlay input');
  return html.replace('</head>', `${analyticsTag}\n</head>`);
}
export async function analyticsScript(config) {
  return (await fs.readFile(new URL('../../../../shared/analytics/browser.js', import.meta.url), 'utf8')) + '\nstartAnalytics(' + JSON.stringify(config) + ');\n';
}
