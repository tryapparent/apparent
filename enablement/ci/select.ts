import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {changedPaths as inputPaths, workflowControlPaths} from './inputs.ts';

import {portableForegroundInputs, foregroundPortableChange, routingProblems, onboardingInput, onboardingPureInputs, retiredOnboardingInputs, routeDecision, documentationOnlyPath, linuxDrivers, suitePlan} from './routing/consumers.ts';
export {documentationOnlyPath} from './routing/consumers.ts';

export function needsPlatform(paths: string[] | null): boolean {
  const plan = suitePlan(paths);
  return plan.root || plan.engine || plan.desktop || plan.client;
}

export function select(paths: string[] | null): {public: boolean; updater: boolean} {
  const {public: publicSelected, updater} = routeDecision(paths);
  return {public: publicSelected, updater};
}

// Exact portable Settings renderer inputs, not a directory/extension exemption.
// Shell, bridge, styles, onboarding, notes and unknown inputs retain Mac proof.
const portableSettings = new Set([
  'storage.tsx', 'retention.tsx', 'connect-settings.tsx',
  'error-reporting.tsx', 'reference.tsx',
].map(name => 'capture/desktop/ui/frontend/src/' + name));

// Exact renderer-only build inputs. See continuous-delivery.md for consumers.
// No TS/TSX/CSS directory glob: bridge, policy, entrypoints and new files fail closed.
export const presentationInputs = new Set([
  ...portableSettings,
  'capture/desktop/ui/frontend/src/style.css',
]);

export function requiresMacRust(paths: string[] | null, unsupported: string[] | null): boolean {
  return paths === null || unsupported === null || !paths.length || unsupported.length > 0 ||
    paths.filter(path => {const plan = suitePlan([path]); return plan.root || plan.engine || plan.client;}).some(path => !presentationInputs.has(path));
}

const portal = 'capture/desktop/linux/capture/portal.rs';
// Audited cfg(linux) leaf adapter; no shared policy or Mac compiler consumer.
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

function changes(base: string, head: string, cwd = process.cwd()): Change[] | null {
  if (!/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) return null;
  try {
    if (git(['rev-parse', '--is-shallow-repository'], cwd).trim() !== 'false') return null;
    git(['merge-base', '--is-ancestor', base, head], cwd);
    const sharedPaths = inputPaths(base, head, cwd);
    // No rename folding: both owner sides remain verification inputs.
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
    // Shared path facts must agree with the additional raw status/mode proof.
    return isDeepStrictEqual(sharedPaths, result.map(change => change.path)) ? result : null;
  } catch {
    return null;
  }
}

const unsupported = (change: Change) => change.status !== 'M' || change.oldMode !== '100644' || change.newMode !== '100644';

// Main's prose exception permits regular additions/deletions and both regular
// rename sides. A symlink, executable or unknown mode is not proven prose.
const regularFileChange = (change: Change) =>
  (change.status === 'M' && change.oldMode === '100644' && change.newMode === '100644') ||
  (change.status === 'A' && change.oldMode === '000000' && change.newMode === '100644') ||
  (change.status === 'D' && change.oldMode === '100644' && change.newMode === '000000');

export function changedPaths(base: string, head: string, nonModificationsOnly = false): string[] | null {
  return changes(base, head)?.filter(change => !nonModificationsOnly || unsupported(change)).map(change => change.path) ?? null;
}

export function selectRange(base: string, head: string, cwd = process.cwd(), conservativeWorkflows = process.env.GITHUB_EVENT_NAME === 'push' && process.env.GITHUB_REF === 'refs/heads/main') {
  try {
    base = git(['rev-parse', '--verify', '--end-of-options', base + '^{commit}'], cwd).trim();
    head = git(['rev-parse', '--verify', '--end-of-options', head + '^{commit}'], cwd).trim();
  } catch { /* Unknown revisions retain conservative selection. */ }
  const delta = changes(base, head, cwd);
  const paths = delta?.map(change => change.path) ?? null;
  // Imports are a property of candidate content. A deleted, previously audited
  // policy file has no candidate imports to inspect; its deletion still flows
  // through the normal consumer and platform boundary decisions below.
  const changedPolicyImports = delta?.filter(change => change.status !== 'D' && onboardingPureInputs.has(change.path)).filter(change => {
    const path = change.path;
    try {return /\b(?:import|require)\b|\bexport\s+[^;]*\bfrom\s*['"]/.test(git(['show', head + ':' + path], cwd));}
    catch {return true;}
  }).map(change => change.path) ?? [];
  const toolingManifests = new Set(['package.json', 'package-lock.json', 'renderer/window-coach.smoke.ts', 'renderer/tsconfig.json'].map(name => 'capture/desktop/ui/frontend/tests/onboarding/' + name));
  const supportedToolingAddition = (change: Change) => toolingManifests.has(change.path) && change.status === 'A' && regularFileChange(change);
  const supportedOnboardingAddition = (change: Change) => change.status === 'A' && regularFileChange(change) && (
    onboardingPureInputs.has(change.path) ||
    (change.path.startsWith('capture/desktop/ui/frontend/src/onboarding/') && /\.(tsx|css)$/.test(change.path)) ||
    (change.path.startsWith('capture/desktop/ui/frontend/tests/onboarding/') && /\.test\.ts$/.test(change.path))
  );
  const supportedOnboardingDeletion = (change: Change) => change.status === 'D' && regularFileChange(change) && retiredOnboardingInputs.has(change.path);
  const changedOnboardingBoundary = delta?.filter(change => change.path.startsWith('capture/desktop/') && onboardingInput(change.path) &&
    ((change.status === 'D' && !supportedOnboardingDeletion(change)) ||
      (change.status === 'A' && !supportedOnboardingAddition(change) && !supportedToolingAddition(change)) ||
      (change.status !== 'D' && change.status !== 'A' && unsupported(change)))).map(change => change.path) ?? [];
  const unsafe = changedOnboardingBoundary.length > 0 || (delta?.some(change => !regularFileChange(change)) ?? false) || changedPolicyImports.length > 0;
  const effective = unsafe ? null : paths;
  const workflowControls = !conservativeWorkflows && effective?.length ? workflowControlPaths(base, head, effective, cwd) : [];
  const foregroundBoundaries = delta?.filter(change => portableForegroundInputs.has(change.path)).filter(change => {
    if (unsupported(change)) return true;
    try {return !foregroundPortableChange(change.path, git(['show', base + ':' + change.path], cwd), git(['show', head + ':' + change.path], cwd));}
    catch {return true;}
  }).map(change => change.path) ?? [];
  const routing = routeDecision(effective, workflowControls, foregroundBoundaries.length > 0);
  const plan = routing.plan;
  const mac = macDecision(effective, delta?.filter(change => unsupported(change) && needsPlatform([change.path])).map(change => change.path) ?? null);
  const platform = plan.root || plan.engine || plan.desktop || plan.client;
  return {...routing, paths: paths ?? [], historyKnown: paths !== null, inputProofKnown: paths !== null && !unsafe, workflowControls, ...mac, platform, plan,
    hermes: plan.hermes, portable: plan.browser || plan.service || plan.tools || plan.foreground,
    reasons: [...routing.reasons,
      ...(delta?.filter(change => !regularFileChange(change)).map(change =>
        `fallback:unproven-input:${change.path}:${change.status}:${change.oldMode}->${change.newMode}`) ?? []),
      ...foregroundBoundaries.map(path => 'foreground:native-boundary:' + path), ...changedPolicyImports.map(path => 'fallback:onboarding-new-import:' + path), ...changedOnboardingBoundary.map(path => 'fallback:onboarding-boundary-change:' + path), ...mac.reasons]};
}

export function requiresMacRustRange(base: string, head: string): boolean {
  const delta = changes(base, head);
  if (delta?.some(change => !regularFileChange(change))) return true;
  return requiresMacRust(delta?.map(change => change.path) ?? null,
    delta?.filter(change => unsupported(change) && (suitePlan([change.path]).root || suitePlan([change.path]).engine || suitePlan([change.path]).client)).map(change => change.path) ?? null);
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
