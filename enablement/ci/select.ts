import {admissionTooling, admissionConsumersKnown} from '../../shared/enablement/ci/inputs.ts';
import {engineIndependentRange} from './routing/engine-inputs/qualify.ts';
import {fixtureCandidate, qualifyFixtures, fixtureMacRequired, fixturePlatformBoundary} from './routing/fixture-portability/qualify.ts';
import {qualifyCiTests} from './routing/test-only/qualify.ts';
import {storageControllers, storageReferences, nativeStorageGraph, portableStorageController} from './routing/record-storage/qualify.ts';
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {changedPaths as inputPaths, matchesRegularBlob, workflowControlPaths} from './inputs.ts';

import {portableForegroundInputs, foregroundPortableChange, routingProblems, onboardingInput, onboardingPureInputs, onboardingWisprInputs, retiredOnboardingInputs, routeDecision, documentationOnlyPath, linuxDrivers, suitePlan} from './routing/consumers.ts';
export {documentationOnlyPath} from './routing/consumers.ts';

export function needsPlatform(paths: string[] | null): boolean {
  const plan = suitePlan(paths);
  return plan.root || plan.engine || plan.desktop || plan.client;
}

export function select(paths: string[] | null): {public: boolean; updater: boolean} {
  const {public: publicSelected, updater} = routeDecision(paths);
  return {public: publicSelected, updater};
}

const portableSettings = new Set([
  'storage.tsx', 'retention.tsx', 'connect-settings.tsx',
  'error-reporting.tsx', 'reference.tsx',
].map(name => 'capture/desktop/ui/frontend/src/' + name));

export const presentationInputs = new Set([
  ...portableSettings,
  'capture/desktop/ui/frontend/src/style.css',
]);

export function requiresMacRust(paths: string[] | null, unsupported: string[] | null): boolean {
  return paths === null || unsupported === null || !paths.length || unsupported.length > 0 ||
    paths.filter(path => {const plan = suitePlan([path]); return plan.root || plan.engine || plan.client;}).some(path => !presentationInputs.has(path));
}

const portal = 'capture/desktop/linux/capture/portal.rs';
const linuxAdapters = new Set(['capture/desktop/linux/integration/appearance.rs']);
const linuxDoc = 'capture/desktop/docs/linux/linux.md';

export function macDecision(paths: string[] | null, nonModifications: string[] | null = []) {
  if (paths === null || nonModifications === null) return {macos: true, reasons: ['mac:unknown-history']};
  if (!paths.length) return {macos: true, reasons: ['mac:empty-delta']};
  const reasons = paths.map(path => {
    if (nonModifications.includes(path)) return 'mac:unsupported-change:' + path;
    if (documentationOnlyPath(path)) return 'docs:reviewed-prose:' + path;
    if (!needsPlatform([path])) return 'owner:portable:' + path;
    if (linuxAdapters.has(path)) return 'linux:reviewed-adapter:' + path;
    if (linuxDrivers.has(path)) return 'linux:reviewed-test-driver:' + path;
    if (portableSettings.has(path)) return 'linux:reviewed-settings:' + path;
    // Audited cfg(linux) module and guide; no Mac build/package consumer.
    if (path === portal || path === linuxDoc) return 'linux:reviewed-portal-input:' + path;
    return 'mac:unproven-input:' + path;
  });
  for (const path of nonModifications) if (!paths.includes(path)) reasons.push('mac:unsupported-change:' + path);
  return {macos: reasons.some(reason => reason.startsWith('mac:')), reasons};
}

export function requiresMac(paths: string[] | null, nonModifications: string[] | null = []): boolean {
  return macDecision(paths, nonModifications).macos;
}

type Change = {path: string; status: string; oldMode: string; newMode: string};
const git = (args: string[], cwd = process.cwd()) => execFileSync('git', args,
  {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});

const resolveCommit = (value: string, cwd?: string) => git(['rev-parse', '--verify', '--end-of-options', value + '^{commit}'], cwd).trim();

function changes(base: string, head: string, cwd = process.cwd()): Change[] | null {
  if (!/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) return null;
  try {
    if (git(['rev-parse', '--is-shallow-repository'], cwd).trim() !== 'false') return null;
    git(['merge-base', '--is-ancestor', base, head], cwd);
    const sharedPaths = inputPaths(base, head, cwd);
    const raw = git(['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none',
      '--raw', '--no-abbrev', '-z', base, head, '--'], cwd);
    if (!raw) return sharedPaths.length ? null : [];
    const parts = raw.split('\0');
    if (parts.pop() !== '' || parts.length % 2 !== 0) return null;
    const result: Change[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const match = /^:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([A-Z])$/.exec(parts[i]);
      if (!match || !parts[i + 1]) return null;
      const [, oldMode, newMode, status] = match;
      result.push({path: parts[i + 1], status, oldMode, newMode});
    }
    return isDeepStrictEqual(sharedPaths, result.map(change => change.path)) ? result : null;
  } catch {
    return null;
  }
}

const unsupported = (change: Change) => change.status !== 'M' || change.oldMode !== '100644' || change.newMode !== '100644';

const regularFileChange = ({status, oldMode, newMode}: Change) =>
  (status === 'M' && oldMode === '100644' && newMode === '100644') ||
  (status === 'A' && oldMode === '000000' && newMode === '100644') ||
  (status === 'D' && oldMode === '100644' && newMode === '000000');

export function changedPaths(base: string, head: string, nonModificationsOnly = false): string[] | null {
  return changes(base, head)?.filter(change => !nonModificationsOnly || unsupported(change)).map(change => change.path) ?? null;
}

export function selectRange(base: string, head: string, cwd = process.cwd(), conservativeWorkflows = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main') {
  try {
    base = resolveCommit(base, cwd);
    head = resolveCommit(head, cwd);
  } catch { }
  const delta = changes(base, head, cwd);
  const paths = delta?.map(change => change.path) ?? null;
  const retired = (c: Change) => {
    if (c.path !== 'capture/agent/scripts/agent-eval.sh' || c.status !== 'D' || c.oldMode !== '100755' || c.newMode !== '000000') return false;
    return matchesRegularBlob(head, 'agent/enablement/context-comparison.ts', '26bf7678dd59e7e782a7dcc394dae75ea9c0163d', cwd);
  };
  const provenFileChange = (change: Change) => regularFileChange(change) || retired(change);
  const changedPolicyImports = delta?.filter(change => change.status !== 'D' && onboardingPureInputs.has(change.path)).filter(change => {
    const path = change.path;
    try {return /\b(?:import|require)\b|\bexport\s+[^;]*\bfrom\s*['"]/.test(git(['show', head + ':' + path], cwd));}
    catch {return true;}
  }).map(change => change.path) ?? [];
  const toolingManifests = new Set(['package.json', 'package-lock.json', 'renderer/window-coach.smoke.ts', 'renderer/tsconfig.json'].map(name => 'capture/desktop/ui/frontend/tests/onboarding/' + name));
  const shortcutSmoke = 'capture/desktop/ui/frontend/tests/onboarding/';
  const shortcutSmokeMove = delta?.some(change => change.path === shortcutSmoke + 'shortcut.smoke.ts' && change.status === 'D' && regularFileChange(change)) &&
    delta?.some(change => change.path === shortcutSmoke + 'renderer/shortcut.smoke.ts' && change.status === 'A' && regularFileChange(change));
  const supportedToolingAddition = (change: Change) => (toolingManifests.has(change.path) || (shortcutSmokeMove && change.path === shortcutSmoke + 'renderer/shortcut.smoke.ts')) && change.status === 'A' && regularFileChange(change);
  const supportedOnboardingAddition = (change: Change) => change.status === 'A' && regularFileChange(change) && (
    ['pipe.rs','session.rs','tests.rs'].some(name => change.path === 'capture/desktop/settings/onboarding/' + name) ||
    onboardingWisprInputs.has(change.path) ||
    onboardingPureInputs.has(change.path) ||
    (change.path.startsWith('capture/desktop/ui/frontend/src/onboarding/') && /\.(tsx|css)$/.test(change.path)) ||
    (change.path.startsWith('capture/desktop/ui/frontend/tests/onboarding/') && /\.test\.ts$/.test(change.path))
  );
  const supportedOnboardingDeletion = (change: Change) => change.status === 'D' && regularFileChange(change) &&
    (retiredOnboardingInputs.has(change.path) || (shortcutSmokeMove && change.path === shortcutSmoke + 'shortcut.smoke.ts'));
  const changedOnboardingBoundary = delta?.filter(change => change.path.startsWith('capture/desktop/') && onboardingInput(change.path) &&
    ((change.status === 'D' && !supportedOnboardingDeletion(change)) ||
      (change.status === 'A' && !supportedOnboardingAddition(change) && !supportedToolingAddition(change)) ||
      (change.status !== 'D' && change.status !== 'A' && unsupported(change)))).map(change => change.path) ?? [];
  const engineBoundary = paths !== null && !engineIndependentRange(base, head, paths, cwd);
  const admissionChanges = delta?.filter(change => admissionTooling(change.path)) ?? [];
  const admissionKnown = !admissionChanges.length || admissionConsumersKnown(cwd, head);
  const supportedAdmission = (change: Change) => admissionKnown && admissionTooling(change.path) &&
    ['M','A','D'].includes(change.status) && [change.oldMode,change.newMode].every(mode => ['000000','100644','100755'].includes(mode));
  const unsafe = !admissionKnown || engineBoundary || changedOnboardingBoundary.length > 0 || (delta?.some(change => !provenFileChange(change) && !supportedAdmission(change)) ?? false) || changedPolicyImports.length > 0;
  const effective = unsafe ? null : paths;
  const workflowControls = !conservativeWorkflows && effective?.length ? workflowControlPaths(base, head, effective, cwd) : [];
  const foregroundBoundaries = delta?.filter(change => portableForegroundInputs.has(change.path)).filter(change => {
    if (unsupported(change)) return true;
    try {return !foregroundPortableChange(change.path, git(['show', base + ':' + change.path], cwd), git(['show', head + ':' + change.path], cwd));}
    catch {return true;}
  }).map(change => change.path) ?? [];
  let qualifiedFixtures: string[] = [];
  if (effective?.some(fixtureCandidate) && delta) {
    try {
      const entries = git(['ls-tree', '-r', head], cwd).trim().split('\n').map(line => {
        const [metadata, path] = line.split('\t'); return {mode: metadata.split(' ')[0], path};
      });
      const fixtureEntries = entries.filter(entry => fixtureCandidate(entry.path));
      if (fixtureEntries.some(entry => entry.mode !== '100644')) throw Error('Unsupported fixture mode');
      const fixtures = fixtureEntries.map(entry => entry.path);
      const patterns = ['/local-tests/fixtures', "/fixtures'", '/fixtures"', ...new Set(fixtures.flatMap(path => {
        const name = path.split('/').at(-1)!;
        return ['/' + name, '/' + name.replace(/\.ts$/, '') + "'", '/' + name.replace(/\.ts$/, '') + '"'];
      }))];
      let references = '';
      try {references = git(['grep', '-I', '-l', '-F', ...patterns.flatMap(name => ['-e', name]), head, '--'], cwd);}
      catch (error) {if ((error as {status?: number}).status !== 1) throw error;}
      const inputs = new Set([...fixtures, ...references.trim().split('\n').filter(Boolean).map(line => line.slice(head.length + 1))]);
      const files = new Map([...inputs].map(path => [path, git(['show', head + ':' + path], cwd)]));
      qualifiedFixtures = qualifyFixtures(files, effective.filter(path => delta.some(change => change.path === path &&
        (change.status === 'M' || change.status === 'A') && regularFileChange(change) &&
        !fixturePlatformBoundary(change.status === 'A' ? '' : git(['show', base + ':' + path], cwd), files.get(path) ?? ''))));
    } catch { }
  }
  let qualifiedStorageControllers: string[] = [];
  if (effective?.some(path => storageControllers.has(path)) && delta) {
    try {
      const references = git(['grep', '-I', '-l', '-E',
        'LocationController|RetentionController|record-storage|record/storage|/location-controller|/retention-controller',
        head, '--', ':!*.md'], cwd).trim().split('\n').map(line => line.slice(head.length + 1));
      const graph = git(['ls-tree', '-r', head, '--', ...nativeStorageGraph.keys()], cwd).trim().split('\n').sort();
      const expectedGraph = [...nativeStorageGraph].map(([path, blob]) => `100644 blob ${blob}\t${path}`).sort();
      if (references.every(path => storageReferences.has(path)) && isDeepStrictEqual(graph, expectedGraph)) {
        qualifiedStorageControllers = delta.filter(change => storageControllers.has(change.path) && !unsupported(change) &&
          portableStorageController(change.path, git(['show', base + ':' + change.path], cwd), git(['show', head + ':' + change.path], cwd)))
          .map(change => change.path);
      }
    } catch { }
  }
  const qualifiedCiTests = effective ? qualifyCiTests(base, head, effective, cwd) : [];
  const qualifiedTooling = [...qualifiedFixtures, ...qualifiedCiTests];
  const routing = routeDecision(effective, workflowControls, foregroundBoundaries.length > 0, qualifiedFixtures, qualifiedCiTests, qualifiedStorageControllers, paths);
  const {plan} = routing;
  const mac = macDecision(effective?.filter(path => !qualifiedTooling.includes(path)) ?? null, delta?.filter(change => unsupported(change) && !qualifiedTooling.includes(change.path) && needsPlatform([change.path])).map(change => change.path) ?? null);
  if (effective?.length && effective.every(path => qualifiedTooling.includes(path))) {mac.macos = false; mac.reasons = [];}
  const fixtureMac = fixtureMacRequired(qualifiedFixtures) || !!effective?.some(path =>
    ['enablement/local-tests/run.ts', 'enablement/ci/select.ts', '.github/workflows/checks.yml'].includes(path) ||
    path.startsWith('enablement/ci/routing/fixture-portability/') || path.startsWith('enablement/ci/install-contracts/'));
  const platform = plan.root || plan.engine || plan.desktop || plan.client;
  return {...routing, paths: paths ?? [], historyKnown: paths !== null, inputProofKnown: paths !== null && !unsafe, workflowControls, ...mac, fixtureMac, qualifiedFixtures, qualifiedCiTests, qualifiedStorageControllers, platform, plan,
    hermes: plan.hermes, portable: plan.browser || plan.service || plan.tools || plan.foreground,
    reasons: [...routing.reasons,
      ...(!admissionKnown ? ['fallback:admission-product-consumer'] : []),
      ...(engineBoundary ? ['fallback:engine-consumer-boundary'] : []),
      ...(delta?.filter(change => !provenFileChange(change) && !supportedAdmission(change)).map(change =>
        `fallback:unproven-input:${change.path}:${change.status}:${change.oldMode}->${change.newMode}`) ?? []),
      ...foregroundBoundaries.map(path => 'foreground:native-boundary:' + path), ...changedPolicyImports.map(path => 'fallback:onboarding-new-import:' + path), ...changedOnboardingBoundary.map(path => 'fallback:onboarding-boundary-change:' + path), ...mac.reasons]};
}

export function requiresMacRustRange(base: string, head: string): boolean {
  const decision = selectRange(base, head);
  if (!decision.inputProofKnown) return true;
  let delta: Change[] | null = null;
  try {
    delta = changes(resolveCommit(base), resolveCommit(head));
  } catch {}
  const qualifiedTooling = [...decision.qualifiedFixtures, ...decision.qualifiedCiTests];
  const nonModifications = delta?.filter(change => unsupported(change) && !qualifiedTooling.includes(change.path) &&
    (suitePlan([change.path]).root || suitePlan([change.path]).engine || suitePlan([change.path]).client)).map(change => change.path) ?? null;
  return requiresMacRust(decision.paths.filter(path => !qualifiedTooling.includes(path)), nonModifications) &&
    (decision.plan.root || decision.plan.engine || decision.plan.client);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const decision = selectRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? '');
  if (process.argv.includes('--admit') && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    const problems = routingProblems(decision);
    if (problems.length) throw Error(problems.join('\n'));
  }
  const {reasons, plan, ...result} = decision;
  const mac_rust = requiresMacRustRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? '');
  const macEnabled = result.macos || !mac_rust;
  const macPlan = {...plan, root: plan.root && mac_rust && macEnabled, engine: plan.engine && mac_rust && macEnabled,
    desktop: plan.desktop && macEnabled, client: plan.client && macEnabled};
  console.log(JSON.stringify({...result, mac_rust, plan, mac_plan: macPlan, reasons}));
  appendFileSync(process.env.GITHUB_OUTPUT!, Object.entries({...result, mac_rust, plan: JSON.stringify(plan), mac_plan: JSON.stringify(macPlan)}).map(([key, value]) => key + '=' + (typeof value === 'object' ? JSON.stringify(value) : String(value)) + '\n').join(''));
}
