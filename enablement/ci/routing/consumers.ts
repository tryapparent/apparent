import {readFileSync} from 'node:fs';
const rule = JSON.parse(readFileSync(new URL('../../../engine/enablement/ci/inputs.json', import.meta.url), 'utf8')) as {root: string; excludedSuffixes: string[]; desktopPermissions: string};
const automaticPaths = [rule.root + '/**', '!' + rule.desktopPermissions + '**', ...rule.excludedSuffixes.map(suffix => '!' + rule.root + '/**/*' + suffix)];
const affectsEngine = (path: string) => path.startsWith(rule.root + '/') && !path.startsWith(rule.desktopPermissions) && !rule.excludedSuffixes.some(suffix => path.endsWith(suffix));
import {admissionTooling} from '../../../shared/enablement/ci/inputs.ts';
import {independentInputs} from './engine-inputs/qualify.ts';
export const owners = ['capture', 'engine', 'desktop', 'capture-tools', 'client', 'client-foreground', 'web', 'service', 'public', 'hermes', 'tooling', 'onboarding', 'engine-media'] as const;
export type Owner = typeof owners[number];
export const desktopPackagingInputs = new Set([
  'capture/desktop/scripts/packaging/install-app.sh',
  'capture/desktop/scripts/packaging/frontend/stage.ts',
]);
import { publicMarkdown, hostedBrowserFixture } from '../../../public/enablement/cd/ci/inputs.ts';
export { publicMarkdown };
export function documentationOnlyPath(path: string): boolean {
  if (!path.endsWith('.md') || publicMarkdown.has(path)) return false;
  if (/(^|\/)(skills?|prompts?|instructions?|tests?|fixtures?|templates?)(\/|$)/i.test(path)) return false;
  if (/(^|\/)AGENTS\.md$/.test(path)) return true;
  if (/(^|\/)(SKILL|CLAUDE|GEMINI)\.md$/i.test(path)) return false;
  return ['CONTEXT.md', 'VERIFICATION.md', 'enablement/refactor.md', 'enablement/local-tests/README.md'].includes(path) ||
    /^(capture\/(engine|desktop|agent)|connect(\/(web|client|service))?|public\/site|shared|enablement|record\/(storage|completion|transcription|media)|engine(\/sdk)?|agent|handoff|onboarding)\/(docs\/|(README|CHANGELOG|CONTRIBUTING|LICENSE)\.md$)/.test(path);
}
export const linuxDrivers = new Set(['capture-smoke.py', 'gui-vm.py', 'gui-vm-reaper.py',
  'test-capture-smoke.py', 'test-gui-vm.py'].map(name => 'capture/desktop/scripts/linux/gui/' + name));
const webAssets = new Set(['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png',
  'hosted/agent-reading-v4.png', 'fonts/HostGrotesk-Variable.ttf', 'brand/apparent-wordmark.svg']
  .map(path => 'public/site/public/assets/' + path));
const toolingRegressionTests = new Set([
  'enablement/local-tests/reuse.test.ts',
  'enablement/prerequisites/native.test.ts',
]);

const frontend = 'capture/desktop/ui/frontend/';
export const onboardingPureInputs = new Set([
  'electron/onboarding/account.ts', 'electron/onboarding/presentation.ts', 'electron/onboarding/selection.ts',
  'src/onboarding/state.ts', 'src/onboarding/shortcut/keys.ts',
].map(path => frontend + path));
export const onboardingWisprInputs = new Set([
  'electron/onboarding/wispr.ts', 'src/onboarding/wispr/motion.ts',
  'src/onboarding/wispr/use-wispr.ts', 'src/onboarding/wispr/frog-sprites.png',
  'tests/onboarding/wispr/smoke.ts',
].map(path => frontend + path));
export const retiredOnboardingInputs = new Set([
  'capture/desktop/settings/onboarding/account.rs',
  ...['electron/onboarding/account.ts', 'tests/onboarding/account.test.ts',
    ...['account.tsx', 'control-guide.tsx', 'control-guide.css', 'permissions.tsx']
      .map(file => 'src/onboarding/' + file),
  ].map(file => frontend + file),
]);
export const onboardingRoots = [frontend + 'src/onboarding/',
  frontend + 'electron/onboarding/', frontend + 'tests/onboarding/'];
const onboardingRendererTestInputs = new Set([
  frontend + 'tests/onboarding/renderer/window-coach.smoke.ts',
  frontend + 'tests/onboarding/renderer/tsconfig.json',
  frontend + 'tests/onboarding/wispr/smoke.ts',
]);
const onboardingConnectInputs = new Set([
  'src/connect/consent.ts', 'src/connect/protocol.ts', 'src/connect/session.ts',
  'src/connect/flow.ts', 'src/bridge.ts', 'tests/connect/flow.test.ts',
  'tests/connect/session.test.ts', 'tests/connect/flow-hook.test.ts',
].map(path => frontend + path));
export function onboardingInput(path: string): boolean {
  return onboardingConnectInputs.has(path) || onboardingRoots.some(root => path.startsWith(root)) ||
    ['onboarding.html', 'electron/onboarding.cjs', 'electron/onboarding-preload.cjs', 'electron/onboarding-protocol.cjs']
      .some(file => path === frontend + file) ||
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
  if (admissionTooling(path)) return ['tooling'];
  if (desktopPackagingInputs.has(path)) return ['capture', 'engine', 'desktop', 'capture-tools', 'client-foreground'];
  if (path.startsWith('engine/')) {
    if (path.startsWith(rule.desktopPermissions)) return ['capture', 'engine', 'desktop'];
    return affectsEngine(path) ? ['engine-media'] : [];
  }
  if (independent.includes('!' + path)) return ['tooling'];
  if (independentInputs.has(path)) return owners.filter(owner => owner !== 'engine-media');
  if (path.startsWith('enablement/ci/') || path === 'enablement/local-tests/run.ts' || path.startsWith('.github/actions/ubuntu-apt/')) return owners;
  if (portableForegroundInputs.has(path)) return ['client-foreground'];
  if (onboardingPureInputs.has(path) || onboardingRendererTestInputs.has(path)) return ['desktop', 'onboarding'];
  if (path.startsWith('capture/desktop/ui/frontend/tests/onboarding/') &&
      (/\.test\.ts$/.test(path) || ['package.json','package-lock.json','tsconfig.json'].some(name => path.endsWith('/' + name)))) return ['onboarding'];
  if (/^(capture\/desktop\/ui\/frontend\/src\/onboarding|onboarding\/renderer)\/.*\.(tsx|css)$/.test(path) ||
      path === 'capture/desktop/ui/frontend/onboarding.html') return ['desktop', 'onboarding'];

  if (publicMarkdown.has(path) && path !== 'capture/agent/skills/apparent/SKILL.md') return ['public'];
  if (path === 'hermes/skills/recordings/SKILL.md') return ['hermes'];
  if (path === 'capture/agent/skills/apparent/SKILL.md') return ['capture', 'engine', 'public'];
  if (/(^|\/)(AGENTS|SKILL|CLAUDE|GEMINI)\.md$/i.test(path) && !['capture/', 'connect/', 'public/', 'hermes/', 'record/'].some(root => path.startsWith(root))) return owners.filter(owner => owner !== 'engine-media');
  const native = /\.(rs|swift|metal|c|cc|cpp|h|mm)$/.test(path) || /(^|\/)Cargo\.(toml|lock)$/.test(path);
  if (/^record\/(?:storage|completion|capture-request|transcription)\/(?:src\/.*\.ts|test\/.*\.test\.ts|package(?:-lock)?\.json|tsconfig(?:\.build)?\.json)$/.test(path) ||
      path === 'record/storage/build.ts') return ['desktop', 'capture'];
  if (path === hostedBrowserFixture) return ['public', 'web'];
  if (path.startsWith('public/')) return webAssets.has(path) ? ['public', 'web'] : ['public'];
  if (!native && path.startsWith('connect/enablement/')) return [path === 'connect/enablement/ci/verify-composition.ts' ? 'web' : 'tooling'];
  if (!native && path.startsWith('connect/web/')) return ['web'];
  if (['connect/client/typescript/src/mcp-wire.ts','connect/client/typescript/src/transfer/contract.ts','connect/client/typescript/contracts.ts'].includes(path)) return ['client', 'capture', 'service'];
  if (path.startsWith('connect/client/')) return ['client', 'capture'];
  if (!native && path.startsWith('connect/service/')) return ['service', 'client', 'web', 'capture'];
  if (path.startsWith('capture/agent/setup/')) return ['capture', 'engine', 'hermes'];
  if (path === '.github/workflows/stream-public.yml') return ['public'];
  if (path === '.github/workflows/stream-connect.yml') return ['capture', 'client', 'client-foreground', 'web', 'service'];
  if (path === '.github/workflows/checks.yml') return ['capture', 'engine', 'desktop', 'client', 'client-foreground', 'web', 'service', 'capture-tools', 'tooling', 'onboarding'];
  if (path.startsWith('hermes/') || path === '.github/workflows/hermes.yml') return ['hermes'];
  if (linuxDrivers.has(path)) return ['capture-tools'];
  if (path.startsWith('capture/desktop/ui/frontend/src/hermes/')) return ['desktop', 'capture', 'hermes'];
  if (path.startsWith('capture/desktop/ui/frontend/')) return ['desktop', 'capture'];
  if (path.startsWith('capture/desktop/scripts/native/foreground/')) return ['capture', 'engine', 'desktop', 'capture-tools'];
  if (path.startsWith('capture/desktop/scripts/') || path.startsWith('capture/agent/scripts/')) return ['capture', 'engine', 'capture-tools'];
  if (path.startsWith('capture/desktop/')) return ['desktop', 'capture', 'engine', 'capture-tools'];
  if (path.startsWith('capture/engine/tests/') || path.startsWith('capture/engine/src/') || ['capture/engine/Cargo.toml', 'capture/engine/Cargo.lock'].includes(path)) return ['engine'];
  if (/^(capture|composition)\//.test(path) || path === 'agent/enablement/context-comparison.ts') return ['capture', 'engine'];
  if (path.startsWith('agent/')) return ['capture'];
  if (path.startsWith('shared/ui/')) return ['public', 'web', 'desktop', 'service', 'capture'];
  if (path === 'shared/assets/brand/apparent-app-icon.svg') return ['public', 'web', 'desktop', 'service', 'capture', 'hermes'];
  if (/^shared\/(analytics|assets)\//.test(path)) return ['public', 'web', 'desktop', 'service', 'capture'];
  if (['Cargo.toml', 'Cargo.lock', 'build.rs', 'main.rs'].includes(path) || path.startsWith('.cargo/') ||
      path.startsWith('enablement/native-build/') || path === 'enablement/build_version.rs' || path === 'enablement/verification.py')
    return ['capture', 'engine', 'desktop', 'client', 'capture-tools'];
  if (path.startsWith('connect/')) return ['capture', 'client', 'web', 'service'];
  if (path.startsWith('record/')) return ['capture', 'engine', 'desktop'];
  if (nativeWorkflowPaths.includes(path)) return ['capture', 'engine', 'desktop', 'client', 'capture-tools'];
  if (path.startsWith('enablement/prerequisites/')) return path.endsWith('.test.ts') ? ['tooling'] : ['capture', 'engine', 'desktop', 'client'];
  if (toolingRegressionTests.has(path)) return ['tooling'];
  if (path.startsWith('enablement/posthog-fixer/') && !native) return ['tooling'];
  if (path.startsWith('enablement/timing/') && !native) return ['tooling'];
  if (path.startsWith('enablement/directory-width/') && !native) return ['tooling'];
  if (path.startsWith('.github/') || path.startsWith('.githooks/')) return owners;
  return path.includes('/') && knownDirectories.includes(path.split('/')[0])
    ? owners.filter(owner => owner !== 'engine-media') : owners;
}
export function consumers(path: string): readonly Owner[] {
  const selected = [...directConsumers(path)];
  if (onboardingInput(path) && !documentationOnlyPath(path) && !selected.includes('onboarding')) selected.push('onboarding');
  return owners.filter(owner => selected.includes(owner) && (owner !== 'engine-media' || affectsEngine(path)));
}
export function selectedOwners(paths: string[] | null): Owner[] {
  if (!paths?.length) return owners.filter(owner => owner !== 'engine-media');
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
const independent = ['!.github/workflows/stream-engine.yml', '!.github/workflows/stream-agent.yml'];
const native = ['Cargo.toml', 'Cargo.lock', 'build.rs', 'main.rs', '.cargo/**',
  '.github/workflows/verification-platform.yml', 'enablement/verification.py',
  'enablement/prerequisites/**', 'enablement/local-tests/**', 'enablement/native-build/**'];
const nativeOnlyTriggers = [...nativeWorkflowPaths.map(path => '!' + path),
  '!enablement/prerequisites/**', '!enablement/native-build/**', '!enablement/verification.py', '!enablement/build_version.rs'];
const directoryPaths = {
  capture: [...common, ...independent, '!.github/workflows/hermes.yml', '!.github/workflows/stream-public.yml', ...native, rule.desktopPermissions + '**', 'capture/**', 'record/**', 'connect/**',
    'agent/**', 'AGENTS.md', 'public/**'],
  connect: [...common, ...independent, '!.github/workflows/hermes.yml', '!.github/workflows/stream-public.yml', ...native, ...desktopPackagingInputs, 'connect/**', 'public/**',
    '.github/workflows/stream-connect.yml', 'enablement/release_gate.py'],
  public: [...common, ...independent, ...nativeOnlyTriggers, '!.github/workflows/stream-connect.yml', '!.github/workflows/hermes.yml', 'public/**', '.github/workflows/stream-public.yml', 'README.md',
    'capture/agent/skills/apparent/SKILL.md', 'capture/agent/docs/usage.md',
    'capture/desktop/docs/guides/recording.md', 'capture/engine/docs/guides/processing.md'],
  hermes: [...common, ...independent, ...nativeOnlyTriggers, '!.github/workflows/stream-connect.yml', '!.github/workflows/stream-public.yml', 'hermes/**', 'capture/agent/setup/**',
    'capture/desktop/ui/frontend/src/hermes/**', '.github/workflows/hermes.yml'],
  engine: automaticPaths,
} as const;
export type Stream = keyof typeof directoryPaths;
const knownDirectories = ['capture', 'record', 'agent', 'connect', 'public', 'hermes', 'enablement', 'shared', 'composition', '.cargo', '.github', '.githooks', 'engine'];
const knownFiles = ['AGENTS.md', 'README.md', 'Cargo.toml', 'Cargo.lock', 'build.rs', 'main.rs'];
export const streamPaths = Object.fromEntries(Object.entries(directoryPaths).map(([stream, paths]) =>
  [stream, stream === 'engine' ? automaticPaths : ['**', ...knownDirectories.map(root => '!' + root + '/**'), ...knownFiles.map(path => '!' + path), ...paths]])) as Record<Stream, string[]>;
export function affectsStream(stream: Stream, path: string): boolean {
  if (stream === 'engine') return affectsEngine(path);
  return streamPaths[stream].reduce((selected, rule) => {
    const pattern = rule.replace(/^!/, '');
    const matches = pattern === '**' || (pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
    return matches ? !rule.startsWith('!') : selected;
  }, false);
}
export function routeDecision(paths: string[] | null, workflowControls: string[] = [], foregroundNative = false, qualifiedFixtures: string[] = [], qualifiedCiTests: string[] = [], qualifiedStorageControllers: string[] = [], enginePaths: string[] | null = paths) {
  const remaining = paths?.filter(path => !workflowControls.includes(path)) ?? null;
  const controlOnly = !!paths?.length && !remaining?.length && workflowControls.length > 0;
  const qualifiedTooling = [...qualifiedFixtures, ...qualifiedCiTests];
  const unqualified = remaining?.filter(path => !qualifiedTooling.includes(path) && !qualifiedStorageControllers.includes(path)) ?? null;
  const selected = controlOnly || (remaining?.length && !unqualified?.length) ? [] : selectedOwners(unqualified).filter(owner => owner !== 'engine-media');
  if (qualifiedTooling.length && !selected.includes('tooling')) selected.push('tooling');
  if (qualifiedStorageControllers.length && !selected.includes('desktop')) selected.push('desktop');
  if (workflowControls.length && !selected.includes('tooling')) selected.push('tooling');
  if (foregroundNative) for (const owner of ['capture', 'client'] as const) if (!selected.includes(owner)) selected.push(owner);
  if (enginePaths?.some(affectsEngine)) selected.push('engine-media');
  const plan = planFromOwners(selected);
  const effective = remaining?.filter(path => !qualifiedCiTests.includes(path) && !documentationOnlyPath(path));
  const unknown = !paths?.length;
  const orchestration = effective?.some(path => path === '.github/workflows/checks.yml' || path.startsWith('enablement/ci/'));
  const publicSelected = selected.includes('public');
  const updater = unknown || !!orchestration || !!effective?.some(path =>
    ['capture/desktop/scripts/linux/gui/', 'capture/desktop/scripts/linux/updater/'].some(prefix => path.startsWith(prefix)) ||
    ['.github/workflows/linux-updater-harness.yml', 'capture/desktop/linux/update.rs',
      'capture/desktop/settings/settings.rs', 'capture/desktop/settings/settings_window.rs'].includes(path));
  const streams = Object.fromEntries(Object.keys(streamPaths).map(stream => [stream, (unknown && stream !== 'engine') || !!paths?.some(path => affectsStream(stream as Stream, path))]));
  const requiredStreams = {capture: plan.root || plan.engine || plan.desktop || plan.client || plan.tools || plan.onboarding,
    connect: plan.browser || plan.service || plan.client || plan.foreground, public: plan.public, hermes: plan.hermes,
    engine: plan.engineMedia};
  const foregroundRuntime = !!remaining?.includes('connect/client/typescript/src/foreground.ts');
  const publicationStreams = {capture: plan.root || plan.engine || plan.desktop || plan.client || foregroundRuntime,
    connect: plan.browser || plan.service, public: plan.public, hermes: plan.hermes, engine: plan.engineMedia};
  return {requiredStreams, publicationStreams, installer: publicationStreams.capture, selected: owners.filter(owner => selected.includes(owner)), plan,
    public: publicSelected, updater, streams,
    suites: plan,
    reasons: unknown ? ['fallback:unknown-or-empty-history'] : paths!.map(path =>
      qualifiedCiTests.includes(path) ? 'tooling:qualified-ci-test:' + path :
      qualifiedStorageControllers.includes(path) ? 'desktop:qualified-storage-controller:' + path :
      qualifiedFixtures.includes(path) ? 'tooling:qualified-fixture:' + path :
      workflowControls.includes(path) ? 'control:verified-concurrency:' + path :
      documentationOnlyPath(path) ? 'docs:reviewed-prose:' + path :
      'consumers:' + consumers(path).join(',') + ':' + path)};
}

export function unownedPaths(paths: string[]): string[] {
  const files = new Set([...knownFiles, '.gitignore', 'CONTRIBUTING.md', 'LICENSE']);
  return paths.filter(path => path.includes('/') ? ![...knownDirectories, 'handoff', 'onboarding'].includes(path.split('/')[0]) : !files.has(path));
}
export function routingProblems(decision: {paths: string[]; historyKnown: boolean; requiredStreams: Record<string, boolean>}): string[] {
  const problems = unownedPaths(decision.paths).map(path => 'Declare directory ownership for ' + path);
  if (!decision.historyKnown) problems.push('Unknown history or unsupported boundary: retain the full suite plan and establish input/consumer proof before automatic admission');
  for (const [stream, required] of Object.entries(decision.requiredStreams))
    if (required && !decision.paths.some(path => affectsStream(stream as Stream, path)))
      problems.push('Conservative ' + stream + ' coverage is outside the automatic workflow filters; update the consumer inventory before admission');
  return problems;
}
