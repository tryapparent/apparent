// Public facts consumed by the repository's single routing decision.
export const publicMarkdown = new Set([
  'README.md', 'capture/agent/skills/apparent/SKILL.md', 'capture/agent/docs/usage.md',
  'capture/desktop/docs/guides/recording.md', 'capture/engine/docs/guides/processing.md',
]);
export const hostedBrowserFixture = 'public/enablement/browser-proof/test-hosted-browser.mjs';
export const verification = { cwd: 'public/site', argv: ['node', '../enablement/site-build/verify.mjs'] };
