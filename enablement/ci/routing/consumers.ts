// Owner facts shared by hosted admission and local pushes. Unknown inputs stay broad.
export const owners = ['capture', 'engine', 'desktop', 'capture-tools', 'client', 'client-foreground', 'web', 'service', 'public', 'hermes', 'tooling', 'onboarding', 'engine-media'] as const;
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
      'connect/service', 'public/site', 'shared', 'enablement', 'record/storage', 'record/completion', 'engine', 'engine/sdk'].some(owner =>
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

// Exact pure policy files have real renderer consumers, but no native build input.
// Native adapters, shortcut validation and durable-save bridges are intentionally
// absent from this exemption. New policy files/imports retain integration.
export const onboardingPureInputs = new Set([
  'electron/onboarding/account.ts', 'electron/onboarding/presentation.ts', 'electron/onboarding/selection.ts',
  'src/onboarding/state.ts', 'src/onboarding/shortcut/keys.ts',
].map(path => 'capture/desktop/ui/frontend/' + path));
// Explicit retirements from the reviewed Electron onboarding port. A deletion
// keeps its consumer and platform proof, while unrelated deletions remain
// unproven boundary changes.
export const retiredOnboardingInputs = new Set([
  'capture/desktop/settings/onboarding/account.rs',
  'capture/desktop/settings/practice.rs',
  'capture/desktop/ui/frontend/electron/onboarding/account.ts',
  'capture/desktop/ui/frontend/src/onboarding/account.tsx',
  'capture/desktop/ui/frontend/tests/onboarding/account.test.ts',
]);
export const onboardingRoots = ['capture/desktop/ui/frontend/src/onboarding/',
  'capture/desktop/ui/frontend/electron/onboarding/', 'capture/desktop/ui/frontend/tests/onboarding/'];
const onboardingRendererTestInputs = new Set([
  'capture/desktop/ui/frontend/tests/onboarding/renderer/window-coach.smoke.ts',
  'capture/desktop/ui/frontend/tests/onboarding/renderer/tsconfig.json',
]);
// Shared Connect consent/session policy is consumed by onboarding and Settings.
// Add the fast policy suite without exempting its bridge or native consumers.
const onboardingConnectInputs = new Set([
  'src/connect/consent.ts', 'src/connect/protocol.ts', 'src/connect/session.ts',
  'src/connect/flow.ts', 'src/bridge.ts', 'tests/connect/flow.test.ts',
  'tests/connect/session.test.ts', 'tests/connect/flow-hook.test.ts',
].map(path => 'capture/desktop/ui/frontend/' + path));
export function onboardingInput(path: string): boolean {
  return onboardingConnectInputs.has(path) || onboardingRoots.some(root => path.startsWith(root)) ||
    ['onboarding.html', 'electron/onboarding.cjs', 'electron/onboarding-preload.cjs', 'electron/onboarding-protocol.cjs']
      .some(file => path === 'capture/desktop/ui/frontend/' + file) ||
    path.startsWith('capture/desktop/settings/onboarding') || path.endsWith('/practice.rs') ||
    path.startsWith('shared/ui/') || path.startsWith('record/');
}
const nativeWorkflowPaths = [".github/workflows/checks.yml",".github/workflows/linux-updater-harness.yml",".github/workflows/release-linux.yml",".github/workflows/release-mac-preview.yml",".github/workflows/verification-platform.yml",".github/workflows/verification.yml"];

export const portableForegroundInputs = new Set([
  'connect/client/typescript/src/foreground.ts', 'connect/client/typescript/test/foreground.test.ts',
]);
export function foregroundPortableChange(path: string, before: string, after: string): boolean {
  const source = path.endsWith('/src/foreground.ts');
  const allowed = source ? ['node:readline', 'node:url'] : ['node:assert/strict', 'node:test', '../src/foreground.ts'];
  const closure = (text: string) => {
    const imports: string[] = [];
    const rest = text.replace(/^\s*import\s+.*?from\s*['"]([^'"]+)['"];?/gm, (_line, name: string) => {imports.push(name); return '';});
    return !/\b(?:import|require)\b/.test(rest.replace(/\bimport\.meta\b/g, '')) && imports.length === allowed.length &&
      imports.every(name => allowed.includes(name)) && new Set(imports).size === allowed.length;
  };
  if (!closure(before) || !closure(after)) return false;
  const resources = /\bprocess\s*[.\[]|\bglobalThis\b|\b(?:fetch|WebSocket|XMLHttpRequest|eval|Function)\s*\(/;
  if (!source) return !resources.test(before) && !resources.test(after);
  const protocol = (text: string) => {
    const types = text.match(/export type Asset[\s\S]*?(?=\nconst fail)/)?.[0];
    const signature = text.match(/export async function uploadForeground[^\n]*/)?.[0];
    const stdio = text.match(/async function stdio\(\)[\s\S]*/)?.[0];
    if (!types || !signature || !stdio || /\bas\s+any\b/.test(text) || resources.test(text.replace(stdio, ''))) return null;
    const channels = text.match(/\b\w+\.(?:request|progress)\s*\(/g) ?? [];
    const packets = [...text.matchAll(/\b\w+\.(request|progress)\s*\(\s*\{([^{}]*)\}\s*\)/g)].map(match => [match[1], match[2]]);
    if (channels.length !== packets.length || /\bport\s*\[/.test(text)) return null;
    const casts = [...text.matchAll(/\bas\s+(\w+)/g)].map(match => match[1]).sort();
    const operations = [...text.matchAll(/operation:\s*['"]([^'"]+)['"]/g)].map(match => match[1]).sort();
    return JSON.stringify({types, signature, stdio, operations, packets, casts});
  };
  const original = protocol(before);
  return original !== null && original === protocol(after);
}

function directConsumers(path: string): readonly Owner[] {
  if (documentationOnlyPath(path)) return [];
  // This producer is not yet adopted by the app. Do not confuse its independent
  // native/SDK closure with the staged legacy capture/engine crate. Consumer
  // adoption must add the pinned artifact's actual app/package edges here.
  if (path.startsWith('engine/') || path === '.github/workflows/stream-engine.yml') return ['engine-media'];
  if (path.startsWith('enablement/ci/') || path === 'enablement/local-tests/run.ts' || path.startsWith('.github/actions/ubuntu-apt/')) return owners;
  if (portableForegroundInputs.has(path)) return ['client-foreground'];
  if (onboardingPureInputs.has(path)) return ['desktop', 'onboarding'];
  if (onboardingRendererTestInputs.has(path)) return ['desktop', 'onboarding'];
  if (path.startsWith('capture/desktop/ui/frontend/tests/onboarding/') &&
      (/\.test\.ts$/.test(path) || ['package.json','package-lock.json','tsconfig.json'].some(name => path.endsWith('/' + name)))) return ['onboarding'];
  if (path.startsWith('capture/desktop/ui/frontend/src/onboarding/') && /\.(tsx|css)$/.test(path) ||
      path === 'capture/desktop/ui/frontend/onboarding.html') return ['desktop', 'onboarding'];

  if (documentationOnlyPath(path)) return [];
  if (publicMarkdown.has(path) && path !== 'capture/agent/skills/apparent/SKILL.md') return ['public'];
  if (path === 'hermes/skills/recordings/SKILL.md') return ['hermes'];
  if (path === 'capture/agent/skills/apparent/SKILL.md') return ['capture', 'engine', 'public'];
  if (/(^|\/)(AGENTS|SKILL|CLAUDE|GEMINI)\.md$/i.test(path) && !['capture/', 'connect/', 'public/', 'hermes/', 'record/'].some(root => path.startsWith(root))) return owners.filter(owner => owner !== 'engine-media');
  // No extension-based native exemption: unexpected native sources in web/tool owners broaden.
  const native = /\.(rs|swift|metal|c|cc|cpp|h|mm)$/.test(path) || /(^|\/)Cargo\.(toml|lock)$/.test(path);
  // Audited headless Record packages feed Desktop's generated adapters and the
  // packaged native application. Unknown files/packages and instructions stay broad.
  if (/^record\/(?:storage|completion)\/(?:src\/.*\.ts|test\/.*\.test\.ts|package(?:-lock)?\.json|tsconfig\.json)$/.test(path) ||
      path === 'record/storage/build.ts') return ['desktop', 'capture'];
  if (path.startsWith('public/')) return webAssets.has(path) ? ['public', 'web'] : ['public'];
  if (!native && path.startsWith('connect/web/')) return ['web'];
  if (path === 'connect/client/typescript/src/mcp-wire.ts') return ['client', 'capture', 'service'];
  if (path.startsWith('connect/client/')) return ['client', 'capture'];
  if (!native && path.startsWith('connect/service/')) return ['service', 'client', 'web', 'capture'];
  if (path.startsWith('capture/agent/setup/')) return ['capture', 'engine', 'hermes'];
  if (path === '.github/workflows/stream-public.yml') return ['public'];
  if (path === '.github/workflows/stream-connect.yml') return ['capture', 'client', 'client-foreground', 'web', 'service'];
  if (path === '.github/workflows/checks.yml') return ['capture', 'engine', 'desktop', 'client', 'client-foreground', 'web', 'service', 'capture-tools', 'tooling', 'onboarding'];
  if (path === '.github/workflows/hermes.yml') return ['hermes'];
  if (path.startsWith('hermes/')) return ['hermes'];
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
  // Native build inputs cannot affect the Rust-independent Public/Hermes packages.
  if (['Cargo.toml', 'Cargo.lock', 'build.rs', 'main.rs'].includes(path) || path.startsWith('.cargo/') ||
      path.startsWith('enablement/native-build/') || path === 'enablement/build_version.rs' || path === 'enablement/verification.py')
    return ['capture', 'engine', 'desktop', 'client', 'capture-tools'];
  if (path.startsWith('connect/')) return ['capture', 'client', 'web', 'service'];
  if (path.startsWith('record/')) return ['capture', 'engine', 'desktop'];
  if (nativeWorkflowPaths.includes(path)) return ['capture', 'engine', 'desktop', 'client', 'capture-tools'];
  if (path.startsWith('enablement/prerequisites/')) return path.endsWith('.test.ts') ? ['tooling'] : ['capture', 'engine', 'desktop', 'client'];
  // Native build helpers and execution-sensitive CI still exercise the complete integration.
  if (toolingRegressionTests.has(path)) return ['tooling'];
  if (path.startsWith('enablement/timing/') && !native) return ['tooling'];
  if (path.startsWith('enablement/directory-width/') && !native) return ['tooling'];
  // Existing unknown legacy inputs keep their previous conservative consumers.
  // Engine does not consume those implementation trees. Unknown top-level
  // ownership still selects every owner and fails the ownership contract.
  if (path.startsWith('.github/') || path.startsWith('.githooks/')) return owners;
  return path.includes('/') && knownDirectories.includes(path.split('/')[0])
    ? owners.filter(owner => owner !== 'engine-media') : owners;
}
export function consumers(path: string): readonly Owner[] {
  const selected = [...directConsumers(path)];
  if (onboardingInput(path) && !documentationOnlyPath(path) && !selected.includes('onboarding')) selected.push('onboarding');
  return owners.filter(owner => selected.includes(owner));
}
export function selectedOwners(paths: string[] | null): Owner[] {
  if (!paths?.length) return [...owners];
  const selected = new Set(paths.flatMap(path => [...consumers(path)]));
  return owners.filter(owner => selected.has(owner));
}
export function planFromOwners(selected: readonly Owner[]) {
  return {root: selected.includes('capture'), engine: selected.includes('engine'),
    desktop: selected.includes('desktop'), client: selected.includes('client'), foreground: selected.includes('client-foreground'),
    browser: selected.includes('web'), service: selected.includes('service'),
    tools: selected.includes('capture-tools'), hermes: selected.includes('hermes'),
    public: selected.includes('public'), tooling: selected.includes('tooling'), onboarding: selected.includes('onboarding'),
    engineMedia: selected.includes('engine-media')};
}
export function suitePlan(paths: string[] | null) {return planFromOwners(selectedOwners(paths));}

const common = ['shared/**', 'composition/**', 'enablement/**', '.github/**', '.githooks/**'];
const independentEngine = ['!.github/workflows/stream-engine.yml'];
const native = ['Cargo.toml', 'Cargo.lock', 'build.rs', 'main.rs', '.cargo/**',
  '.github/workflows/verification-platform.yml', 'enablement/verification.py',
  'enablement/prerequisites/**', 'enablement/local-tests/**', 'enablement/native-build/**'];
const nativeOnlyTriggers = [...nativeWorkflowPaths.map(path => '!' + path),
  '!enablement/prerequisites/**', '!enablement/native-build/**', '!enablement/verification.py', '!enablement/build_version.rs'];
const directoryPaths = {
  capture: [...common, ...independentEngine, '!.github/workflows/hermes.yml', '!.github/workflows/stream-public.yml', ...native, 'capture/**', 'record/**', 'connect/**', '!connect/web/**',
    'enablement/**', '.githooks/**', 'AGENTS.md', '.github/workflows/checks.yml',
    '.github/workflows/verification.yml',
    '.github/workflows/release-linux.yml', '.github/workflows/release-mac-preview.yml',
    '.github/workflows/linux-updater-harness.yml',
    // The app embeds this wordmark; the remaining Public tree is independent.
    'public/site/public/assets/brand/apparent-wordmark.svg'],
  connect: [...common, ...independentEngine, '!.github/workflows/hermes.yml', '!.github/workflows/stream-public.yml', ...native, 'connect/**', 'public/site/**',
    '.github/workflows/stream-connect.yml', 'enablement/release_gate.py'],
  public: [...common, ...independentEngine, ...nativeOnlyTriggers, '!.github/workflows/stream-connect.yml', '!.github/workflows/hermes.yml', 'public/**', '.github/workflows/stream-public.yml', 'README.md',
    'capture/agent/skills/apparent/SKILL.md', 'capture/agent/docs/usage.md',
    'capture/desktop/docs/guides/recording.md', 'capture/engine/docs/guides/processing.md'],
  hermes: [...common, ...independentEngine, ...nativeOnlyTriggers, '!.github/workflows/stream-connect.yml', '!.github/workflows/stream-public.yml', 'hermes/**', 'capture/agent/setup/**',
    'capture/desktop/ui/frontend/src/hermes/**', '.github/workflows/hermes.yml'],
  engine: ['engine/**', 'enablement/ci/**', 'enablement/local-tests/**', '.githooks/**', '.github/**',
    ...nativeWorkflowPaths.map(path => '!' + path), '!.github/workflows/hermes.yml',
    '!.github/workflows/stream-connect.yml', '!.github/workflows/stream-public.yml', '.github/workflows/stream-engine.yml'],
} as const;
export type Stream = keyof typeof directoryPaths;
const knownDirectories = ['capture', 'record', 'connect', 'public', 'hermes', 'enablement', 'shared', 'composition', '.cargo', '.github', '.githooks', 'engine'];
const knownFiles = ['AGENTS.md', 'README.md', 'Cargo.toml', 'Cargo.lock', 'build.rs', 'main.rs'];
export const streamPaths = Object.fromEntries(Object.entries(directoryPaths).map(([stream, paths]) =>
  [stream, ['**', ...knownDirectories.map(root => '!' + root + '/**'), ...knownFiles.map(path => '!' + path), ...paths]])) as Record<Stream, string[]>;
export function affectsStream(stream: Stream, path: string): boolean {
  return streamPaths[stream].reduce((selected, rule) => {
    const pattern = rule.replace(/^!/, '');
    const matches = pattern === '**' || (pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
    return matches ? !rule.startsWith('!') : selected;
  }, false);
}

// One decision feeds local commands, hosted suite gates and explainable output.
export function routeDecision(paths: string[] | null, workflowControls: string[] = [], foregroundNative = false) {
  const remaining = paths?.filter(path => !workflowControls.includes(path)) ?? null;
  const controlOnly = !!paths?.length && !remaining?.length && workflowControls.length > 0;
  const selected = controlOnly ? [] : selectedOwners(remaining);
  if (workflowControls.length && !selected.includes('tooling')) selected.push('tooling');
  if (foregroundNative) for (const owner of ['capture', 'client'] as const) if (!selected.includes(owner)) selected.push(owner);
  const plan = planFromOwners(selected);
  const effective = remaining?.filter(path => !documentationOnlyPath(path));
  const unknown = !paths?.length;
  const orchestration = effective?.some(path => path === '.github/workflows/checks.yml' || path.startsWith('enablement/ci/'));
  const publicSelected = selected.includes('public');
  if (publicSelected && !selected.includes('public')) selected.push('public');
  const updater = unknown || !!orchestration || !!effective?.some(path =>
    ['capture/desktop/scripts/linux/gui/', 'capture/desktop/scripts/linux/updater/'].some(prefix => path.startsWith(prefix)) ||
    ['.github/workflows/linux-updater-harness.yml', 'capture/desktop/linux/update.rs',
      'capture/desktop/settings/settings.rs', 'capture/desktop/settings/settings_window.rs'].includes(path));
  const streams = Object.fromEntries(Object.keys(streamPaths).map(stream => [stream, unknown || !!paths?.some(path => affectsStream(stream as Stream, path))]));
  const requiredStreams = {capture: plan.root || plan.engine || plan.desktop || plan.client || plan.tools || plan.onboarding,
    connect: plan.browser || plan.service || plan.client || plan.foreground, public: plan.public, hermes: plan.hermes,
    engine: plan.engineMedia};
  // Verification-only inputs must not strand a pending unchanged product.
  // Native clients consume Connect, but are not inputs to its Worker payload.
  const foregroundRuntime = !!remaining?.includes('connect/client/typescript/src/foreground.ts');
  const publicationStreams = {capture: plan.root || plan.engine || plan.desktop || plan.client || foregroundRuntime,
    connect: plan.browser || plan.service, public: plan.public, hermes: plan.hermes, engine: plan.engineMedia};
  return {requiredStreams, publicationStreams, installer: publicationStreams.capture, selected: owners.filter(owner => selected.includes(owner)), plan,
    public: publicSelected, updater, streams,
    suites: plan,
    reasons: unknown ? ['fallback:unknown-or-empty-history'] : paths!.map(path =>
      workflowControls.includes(path) ? 'control:verified-concurrency:' + path :
      documentationOnlyPath(path) ? 'docs:reviewed-prose:' + path :
      'consumers:' + consumers(path).join(',') + ':' + path)};
}

export function unownedPaths(paths: string[]): string[] {
  const files = new Set([...knownFiles, '.gitignore', 'CONTRIBUTING.md', 'LICENSE']);
  return paths.filter(path => path.includes('/') ? !knownDirectories.includes(path.split('/')[0]) : !files.has(path));
}
export function routingProblems(decision: {paths: string[]; historyKnown: boolean; requiredStreams: Record<string, boolean>}): string[] {
  const problems = unownedPaths(decision.paths).map(path => 'Declare directory ownership for ' + path);
  if (!decision.historyKnown) problems.push('Unknown history or unsupported boundary: retain the full suite plan and establish input/consumer proof before automatic admission');
  for (const [stream, required] of Object.entries(decision.requiredStreams))
    if (required && !decision.paths.some(path => affectsStream(stream as Stream, path)))
      problems.push('Conservative ' + stream + ' coverage is outside the automatic workflow filters; update the consumer inventory before admission');
  return problems;
}
