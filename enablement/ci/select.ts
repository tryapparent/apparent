import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {changedPaths as inputPaths} from './inputs.ts';

import {affectsStream} from './routing/streams.ts';
import {publicMarkdown, documentationOnlyPath, linuxDrivers, selectedOwners, suitePlan} from './routing/consumers.ts';
export {documentationOnlyPath} from './routing/consumers.ts';

export function needsPlatform(paths: string[] | null): boolean {
  const plan = suitePlan(paths);
  return plan.root || plan.engine || plan.desktop || plan.client;
}

// Preserve main's Public/updater input sets and ordinary-prose exception.
export function select(paths: string[] | null): {public: boolean; updater: boolean} {
  if (!paths?.length) return {public: true, updater: true};
  paths = paths.filter(path => !documentationOnlyPath(path));
  if (!paths.length) return {public: false, updater: false};
  const orchestration = paths.some(path => path === '.github/workflows/checks.yml' || path.startsWith('enablement/ci/'));
  return {
    public: paths.some(path => affectsStream('public', path)) || selectedOwners(paths).includes('public') || orchestration || paths.some(path =>
      publicMarkdown.has(path) ||
      ['public/site/', 'shared/ui/', 'shared/analytics/', 'shared/assets/'].some(prefix => path.startsWith(prefix)) ||
      path === '.github/workflows/stream-public.yml'),
    updater: orchestration || paths.some(path =>
      ['capture/desktop/scripts/linux/gui/', 'capture/desktop/scripts/linux/updater/'].some(prefix => path.startsWith(prefix)) ||
      ['.github/workflows/linux-updater-harness.yml', 'capture/desktop/linux/update.rs',
        'capture/desktop/settings/settings.rs', 'capture/desktop/settings/settings_window.rs'].includes(path)),
  };
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
const git = (args: string[]) => execFileSync('git', args,
  {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});

function changes(base: string, head: string): Change[] | null {
  if (!/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) return null;
  try {
    if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') return null;
    git(['merge-base', '--is-ancestor', base, head]);
    const sharedPaths = inputPaths(base, head, process.cwd());
    // No rename folding: both owner sides remain verification inputs.
    const raw = git(['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none',
      '--raw', '--no-abbrev', '-z', base, head, '--']);
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

export function selectRange(base: string, head: string) {
  const delta = changes(base, head);
  const paths = delta?.map(change => change.path) ?? null;
  const unsafe = delta?.some(change => !regularFileChange(change)) ?? false;
  const effective = unsafe ? null : paths;
  const plan = suitePlan(effective);
  const mac = macDecision(effective, delta?.filter(change => unsupported(change) && needsPlatform([change.path])).map(change => change.path) ?? null);
  const platform = needsPlatform(effective);
  return {...select(effective), ...mac, platform, plan,
    hermes: plan.hermes, portable: plan.browser || plan.service || plan.tools,
    reasons: mac.reasons};
}

export function requiresMacRustRange(base: string, head: string): boolean {
  const delta = changes(base, head);
  if (delta?.some(change => !regularFileChange(change))) return true;
  return requiresMacRust(delta?.map(change => change.path) ?? null,
    delta?.filter(change => unsupported(change) && (suitePlan([change.path]).root || suitePlan([change.path]).engine || suitePlan([change.path]).client)).map(change => change.path) ?? null);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {reasons, plan, ...result} = selectRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? '');
  const mac_rust = requiresMacRustRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? '');
  const macEnabled = result.macos || !mac_rust;
  const macPlan = {...plan, root: plan.root && mac_rust && macEnabled, engine: plan.engine && mac_rust && macEnabled,
    desktop: plan.desktop && macEnabled, client: plan.client && macEnabled};
  console.log(JSON.stringify({...result, mac_rust, plan, mac_plan: macPlan, reasons}));
  appendFileSync(process.env.GITHUB_OUTPUT!, Object.entries({...result, mac_rust, plan: JSON.stringify(plan), mac_plan: JSON.stringify(macPlan)}).map(([key, value]) => key + '=' + value + '\n').join(''));
}
