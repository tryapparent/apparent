// Owner facts shared by hosted admission and local pushes. Unknown inputs stay broad.
export const owners = ['capture', 'engine', 'desktop', 'capture-tools', 'client', 'client-foreground', 'web', 'service', 'public', 'hermes', 'tooling'] as const;
export type Owner = typeof owners[number];
export const publicMarkdown = new Set([
  'README.md', 'capture/agent/skills/apparent/SKILL.md', 'capture/agent/docs/usage.md',
  'capture/desktop/docs/guides/recording.md', 'capture/engine/docs/guides/processing.md',
]);
export function documentationOnlyPath(path: string): boolean {
  if (!path.endsWith('.md') || publicMarkdown.has(path)) return false;
  if (/(^|\/)(skills?|prompts?|instructions?|tests?|fixtures?|templates?)(\/|$)/i.test(path)) return false;
  // Repository development guidance is not a product build input. Embedded
  // skills/prompts/fixtures above still retain their actual consumers.
  if (/(^|\/)AGENTS\.md$/.test(path)) return true;
  if (/(^|\/)(SKILL|CLAUDE|GEMINI)\.md$/i.test(path)) return false;
  return ['CONTEXT.md', 'VERIFICATION.md', 'enablement/refactor.md'].includes(path) ||
    ['capture/engine', 'capture/desktop', 'capture/agent', 'connect', 'connect/web', 'connect/client',
      'connect/service', 'public/site', 'shared', 'enablement'].some(owner =>
      path.startsWith(owner + '/docs/') || ['README', 'CHANGELOG', 'CONTRIBUTING', 'LICENSE'].some(name => path === `${owner}/${name}.md`));
}
export const linuxDrivers = new Set(['capture-smoke.py', 'gui-vm.py', 'gui-vm-reaper.py',
  'test-capture-smoke.py', 'test-gui-vm.py'].map(name => 'capture/desktop/scripts/linux/gui/' + name));
const webAssets = new Set(['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png',
  'hosted/agent-reading-v4.png', 'fonts/HostGrotesk-Variable.ttf', 'brand/apparent-wordmark.svg']
  .map(path => 'public/site/public/assets/' + path));

// These are isolated Enablement regression tests. They are also run by the
// always-on contracts command; changing them does not change their tested
// runtime/build consumers. Keep this inventory exact so new Enablement files
// and execution inputs retain the conservative owner fallback.
const toolingRegressionTests = new Set([
  'enablement/local-tests/reuse.test.ts',
  'enablement/prerequisites/native.test.ts',
]);

// This stdio policy module and its direct tests are dependency-free TypeScript.
// Keep the group exact: package, adapter, crypto, share and unknown client
// inputs retain the real native client/application consumers below.
const portableForeground = new Set([
  'connect/client/typescript/src/foreground.ts',
  'connect/client/typescript/test/foreground.test.ts',
]);

export function consumers(path: string): readonly Owner[] {
  if (documentationOnlyPath(path)) return [];
  if (publicMarkdown.has(path) && path !== 'capture/agent/skills/apparent/SKILL.md') return ['public'];
  if (path === 'hermes/skills/recordings/SKILL.md') return ['hermes'];
  if (/(^|\/)(AGENTS|SKILL|CLAUDE|GEMINI)\.md$/i.test(path)) return owners;
  // No extension-based native exemption: unexpected native sources in web/tool owners broaden.
  const native = /\.(rs|swift|metal|c|cc|cpp|h|mm)$/.test(path) || /(^|\/)Cargo\.(toml|lock)$/.test(path);
  // Audited headless Record packages feed Desktop's generated adapters and the
  // packaged native application. Unknown files/packages and instructions stay broad.
  if (/^record\/(?:storage|completion)\/(?:src\/.*\.ts|test\/.*\.test\.ts|package(?:-lock)?\.json|tsconfig\.json)$/.test(path) ||
      path === 'record/storage/build.ts') return ['desktop', 'capture'];
  if (portableForeground.has(path)) return ['client-foreground'];
  if (!native && path.startsWith('public/site/')) return webAssets.has(path) ? ['public', 'web'] : ['public'];
  if (!native && path.startsWith('connect/web/')) return ['web'];
  if (path.startsWith('connect/client/')) return ['client', 'capture'];
  if (!native && path.startsWith('connect/service/')) return ['service', 'client', 'web', 'public', 'capture'];
  if (path.startsWith('capture/agent/setup/')) return ['capture', 'engine', 'hermes'];
  if (path === '.github/workflows/hermes.yml') return ['hermes'];
  if (!native && path.startsWith('hermes/')) return ['hermes'];
  if (linuxDrivers.has(path)) return ['capture-tools'];
  if (path.startsWith('capture/desktop/ui/frontend/src/hermes/')) return ['desktop', 'capture', 'hermes'];
  if (path.startsWith('capture/desktop/ui/frontend/')) return ['desktop', 'capture'];
  if (path.startsWith('capture/desktop/scripts/') || path.startsWith('capture/agent/scripts/')) return ['capture', 'engine', 'capture-tools'];
  if (path.startsWith('capture/desktop/')) return ['desktop', 'capture', 'engine', 'capture-tools'];
  if (path.startsWith('capture/engine/tests/') || path.startsWith('capture/engine/src/') || ['capture/engine/Cargo.toml', 'capture/engine/Cargo.lock'].includes(path)) return ['engine'];
  if (path.startsWith('capture/') || path.startsWith('composition/')) return ['capture', 'engine'];
  if (path.startsWith('shared/analytics/')) return ['public', 'web', 'service', 'desktop', 'capture'];
  if (path.startsWith('shared/ui/')) return ['public', 'web', 'desktop', 'service', 'capture'];
  if (path.startsWith('shared/assets/')) return ['public', 'web', 'desktop', 'service', 'capture'];
  // Native build helpers and execution-sensitive CI still exercise the complete integration.
  if (toolingRegressionTests.has(path)) return ['tooling'];
  if (path.startsWith('enablement/timing/') && !native) return ['tooling'];
  if (path.startsWith('enablement/directory-width/') && !native) return ['tooling'];
  return owners;
}
export function selectedOwners(paths: string[] | null): Owner[] {
  if (!paths?.length) return [...owners];
  const selected = new Set(paths.flatMap(path => [...consumers(path)]));
  return owners.filter(owner => selected.has(owner));
}
export function nativeInputs(paths: string[] | null): boolean {
  return selectedOwners(paths).some(owner => ['capture', 'engine', 'client'].includes(owner));
}
export function suitePlan(paths: string[] | null) {
  const selected = selectedOwners(paths);
  return {root: selected.includes('capture'), engine: selected.includes('engine'),
    desktop: selected.includes('desktop'), client: selected.includes('client'),
    foreground: selected.includes('client-foreground'), browser: selected.includes('web'), service: selected.includes('service'),
    tools: selected.includes('capture-tools'), hermes: selected.includes('hermes')};
}
