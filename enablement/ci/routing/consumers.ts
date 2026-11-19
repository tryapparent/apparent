import {readFileSync} from 'node:fs';
import {portableForegroundInputs, serviceOnlyInputs} from '../../../shared/enablement/ci/connect-inputs.ts';
import {bendConsumers} from '../../../shared/enablement/bend/consumers.ts';
const rule = JSON.parse(readFileSync(new URL('../../../engine/enablement/ci/inputs.json', import.meta.url), 'utf8')) as {root: string; excludedSuffixes: string[]; desktopPermissions: string};
const automaticPaths = [rule.root + '/**', '!' + rule.desktopPermissions + '**', ...rule.excludedSuffixes.map(suffix => '!' + rule.root + '/**/*' + suffix)];
const affectsEngine = (path: string) => path.startsWith(rule.root + '/') && !path.startsWith(rule.desktopPermissions) && !rule.excludedSuffixes.some(suffix => path.endsWith(suffix));
import {admissionTooling, branchCleanupInput, connectConsumers, nativeWorkflowPaths} from '../../../shared/enablement/ci/inputs.ts';
import {independentInputs} from './engine-inputs/qualify.ts';
export const owners = ['capture', 'engine', 'desktop', 'capture-tools', 'client', 'client-foreground', 'web', 'service', 'public', 'hermes', 'tooling', 'onboarding', 'engine-media'] as const;
export type Owner = typeof owners[number];
export const desktopPackagingInputs = new Set(['install-app.sh', 'frontend/stage.ts']
  .map(file => 'capture/desktop/scripts/packaging/' + file));
import { publicMarkdown, hostedBrowserFixture } from '../../../public/enablement/cd/ci/inputs.ts';
export { publicMarkdown };
const proseRoots = ['capture', 'record', 'agent', 'connect', 'public', 'hermes', 'enablement', 'shared', 'composition', 'engine', 'handoff', 'onboarding'];
const rootProse = new Set(['CONTRIBUTING.md', 'LICENSE', 'NOTICE', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CONTEXT.md', 'VERIFICATION.md']);
const productMarkdown = new Set(['hermes/README.md', 'connect/client/typescript/README.md']);
const embeddedSegments = /(^|\/)(skills?|prompts?|instructions?|tests?|fixtures?|templates?)(\/|$)/i;
export function documentationOnlyPath(path: string): boolean {
  if (rootProse.has(path) || /^agent\/skills\/(?:\.gitattributes|pitch-deck\/.*\.md)$/.test(path)) return true;
  if (!path.endsWith('.md') || publicMarkdown.has(path) || productMarkdown.has(path)) return false;
  if (/^public\/site\/(public|src|brand\/(src|shared))\//.test(path)) return false;
  if (embeddedSegments.test(path) && !/(^|\/)README\.md$/i.test(path)) return false;
  if (/(^|\/)AGENTS\.md$/.test(path)) return true;
  if (/(^|\/)(AGENTS|SKILL|CLAUDE|GEMINI)[^/]*\.md$/i.test(path)) return false;
  return proseRoots.includes(path.split('/')[0]);
}
export const linuxDrivers = new Set(['capture-smoke.py', 'gui-vm.py', 'gui-vm-reaper.py',
  'test-capture-smoke.py', 'test-gui-vm.py'].map(name => 'capture/desktop/scripts/linux/gui/' + name));
const webAssets = new Set(['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png',
  'hosted/agent-reading-v4.png', 'fonts/HostGrotesk-Variable.ttf', 'brand/apparent-wordmark.svg']
  .map(path => 'public/site/public/assets/' + path));
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
export const onboardingRoots = ['src', 'electron', 'tests'].map(dir => frontend + dir + '/onboarding/');
const onboardingRendererTestInputs = new Set([
  'renderer/window-coach.smoke.ts', 'renderer/tsconfig.json', 'wispr/smoke.ts',
].map(file => frontend + 'tests/onboarding/' + file));
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
function directConsumers(path: string): readonly Owner[] {
  if (documentationOnlyPath(path)) return [];
  if (branchCleanupInput(path)) return ['tooling'];
  if (admissionTooling(path)) return ['tooling'];
  if (desktopPackagingInputs.has(path)) return ['capture', 'engine', 'desktop', 'capture-tools', 'client-foreground'];
  if (path.startsWith(rule.desktopPermissions)) return ['capture', 'engine', 'desktop'];
  if (path.startsWith('engine/')) return affectsEngine(path) ? ['engine-media'] : [];
  if (independent.includes('!' + path)) return ['tooling'];
  if (independentInputs.has(path)) return owners.filter(owner => owner !== 'engine-media');
  if (path.startsWith('enablement/ci/') || path === 'enablement/local-tests/run.ts' || path.startsWith('.github/actions/ubuntu-apt/')) return owners;
  if (portableForegroundInputs.has(path)) return ['client-foreground'];
  if (onboardingPureInputs.has(path) || onboardingRendererTestInputs.has(path)) return ['desktop', 'onboarding'];
  if (path.startsWith(frontend + 'tests/onboarding/') &&
      (/\.test\.ts$/.test(path) || ['package.json','package-lock.json','tsconfig.json'].some(name => path.endsWith('/' + name)))) return ['onboarding'];
  if (/^(capture\/desktop\/ui\/frontend\/src\/onboarding|onboarding\/renderer)\/.*\.(tsx|css)$/.test(path) ||
      path === frontend + 'onboarding.html') return ['desktop', 'onboarding'];

  if (publicMarkdown.has(path) && path !== 'capture/agent/skills/apparent/SKILL.md') return ['public'];
  if (path === 'hermes/skills/recordings/SKILL.md') return ['hermes'];
  if (path === 'capture/agent/skills/apparent/SKILL.md') return ['capture', 'engine', 'public'];
  if (/(^|\/)(AGENTS|SKILL|CLAUDE|GEMINI)\.md$/i.test(path) && !['capture/', 'connect/', 'public/', 'hermes/', 'record/'].some(root => path.startsWith(root))) return owners.filter(owner => owner !== 'engine-media');
  const native = /\.(rs|swift|metal|c|cc|cpp|h|mm)$/.test(path) || /(^|\/)Cargo\.(toml|lock)$/.test(path);
  if (/^record\/(?:storage|completion|capture-request|transcription)\/(?:src\/.*\.ts|test\/.*\.test\.ts|package(?:-lock)?\.json|tsconfig(?:\.build)?\.json)$/.test(path) ||
      path === 'record/storage/build.ts') return ['desktop', 'capture'];
  if (path === hostedBrowserFixture) return ['public', 'web'];
  if (path.startsWith('public/')) return webAssets.has(path) ? ['public', 'web'] : ['public'];
  const connect = connectConsumers(path, native);
  if (connect) return connect;
  if (path.startsWith('capture/agent/setup/')) return ['capture', 'engine', 'hermes'];
  if (path === '.github/workflows/stream-public.yml') return ['public'];
  if (path === '.github/workflows/stream-connect.yml') return ['capture', 'client', 'client-foreground', 'web', 'service'];
  if (path === '.github/workflows/checks.yml') return ['capture', 'engine', 'desktop', 'client', 'client-foreground', 'web', 'service', 'capture-tools', 'tooling', 'onboarding'];
  if (/^(hermes\/|\.github\/workflows\/hermes\.yml$)/.test(path)) return ['hermes'];
  if (linuxDrivers.has(path)) return ['capture-tools'];
  if (path.startsWith(frontend + 'src/hermes/')) return ['desktop', 'capture', 'hermes'];
  if (/^(capture\/desktop\/ui\/frontend|composition\/quit)\//.test(path)) return ['desktop', 'capture'];
  if (path.startsWith('capture/desktop/scripts/native/foreground/')) return ['capture', 'engine', 'desktop', 'capture-tools'];
  if (/^capture\/(desktop|agent)\/scripts\//.test(path)) return ['capture', 'engine', 'capture-tools'];
  if (path.startsWith('capture/desktop/')) return ['desktop', 'capture', 'engine', 'capture-tools'];
  if (/^capture\/engine\/(tests\/|src\/|Cargo\.(toml|lock)$)/.test(path)) return ['engine'];
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
  if (path === 'enablement/local-tests/reuse.test.ts') return ['tooling'];
  if (!native && /^enablement\/(posthog-fixer|timing|directory-width)\//.test(path)) return ['tooling'];
  if (path.startsWith('.github/') || path.startsWith('.githooks/')) return owners;
  return path.includes('/') && knownDirectories.includes(path.split('/')[0])
    ? owners.filter(owner => owner !== 'engine-media') : owners;
}
export function consumers(path: string): readonly Owner[] {
  const bend = bendConsumers(path);
  if (bend) return bend;
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
    'agent/**', 'AGENTS.md', 'public/**', ...Array.from(serviceOnlyInputs, path => '!' + path)],
  connect: [...common, ...independent, '!.github/workflows/hermes.yml', '!.github/workflows/stream-public.yml', ...native, ...desktopPackagingInputs, 'connect/**', 'public/**',
    '.github/workflows/stream-connect.yml', 'enablement/release_gate.py'],
  public: [...common, ...independent, ...nativeOnlyTriggers, '!.github/workflows/stream-connect.yml', '!.github/workflows/hermes.yml', 'public/**', '.github/workflows/stream-public.yml', 'README.md',
    'capture/agent/skills/apparent/SKILL.md', 'capture/agent/docs/usage.md',
    'capture/desktop/docs/guides/recording.md', 'capture/engine/docs/guides/processing.md'],
  hermes: [...common, ...independent, ...nativeOnlyTriggers, '!.github/workflows/stream-connect.yml', '!.github/workflows/stream-public.yml', 'hermes/**', 'capture/agent/setup/**',
    frontend + 'src/hermes/**', '.github/workflows/hermes.yml'],
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
  const orchestration = effective?.some(path => path === '.github/workflows/checks.yml' ||
    (path.startsWith('enablement/ci/') && !branchCleanupInput(path)));
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
