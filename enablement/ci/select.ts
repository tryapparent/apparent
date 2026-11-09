import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {changedPaths as inputPaths} from './inputs.ts';

// Keep the previous automatic Public/updater input sets. Changes to this
// orchestration also exercise both consumers before they land.
export function select(paths: string[] | null): {public: boolean; updater: boolean} {
  if (paths === null) return {public: true, updater: true};
  const orchestration = paths.some(path => path === '.github/workflows/checks.yml' || path.startsWith('enablement/ci/'));
  return {
    public: orchestration || paths.some(path =>
      ['public/site/', 'shared/ui/', 'shared/analytics/', 'shared/assets/'].some(prefix => path.startsWith(prefix)) ||
      path === '.github/workflows/stream-public.yml' ||
      // Public's feature audit reads this guide's referenced headings.
      path === 'capture/desktop/docs/linux/linux.md'),
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

const portal = 'capture/desktop/linux/capture/portal.rs';
const linuxDoc = 'capture/desktop/docs/linux/linux.md';
const featureMap = 'public/site/src/features.json';

// A schema-bounded comparison, not a prose/PR/SHA classifier. Only direct note
// strings may differ; unknown fields/contracts require Mac. The real Public
// shape/build checks and Linux Rust feature_map audit still run unchanged.
export function featureNotesOnly(before: string, after: string): boolean {
  const fields = (value: any, allowed: string[]) => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key));
  const strings = (value: any, names: string[]) => names.every(name => typeof value[name] === 'string');
  const strip = (text: string) => {
    const map = JSON.parse(text);
    if (!fields(map, ['groups', 'flow', 'features']) ||
      !Array.isArray(map.groups) || !map.groups.every((g: any) => fields(g, ['id', 'title']) && strings(g, ['id', 'title'])) ||
      !Array.isArray(map.flow) || !map.flow.every((f: any) => fields(f, ['title', 'detail', 'group']) && strings(f, ['title', 'detail', 'group'])) ||
      !Array.isArray(map.features) || !map.features.length) throw Error('Unknown feature map');
    const ids = new Set<string>();
    map.features = map.features.map((feature: any) => {
      if (!fields(feature, ['id', 'group', 'name', 'says', 'status', 'platforms', 'added',
        'note', 'flag', 'pr', 'shortcuts', 'config', 'docs']) ||
        typeof feature.id !== 'string' || !/^[a-z0-9-]+$/.test(feature.id) || ids.has(feature.id) ||
        !strings(feature, ['group', 'name', 'says', 'status']) || !feature.name || !feature.says ||
        !/^(?:main|stable@\d+\.\d+\.\d+|experiment:[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*|branch:[\w./-]+|review:#\d+)$/.test(feature.status) ||
        !Array.isArray(feature.platforms) || !feature.platforms.length ||
        !feature.platforms.every((platform: any) => platform === 'mac' || platform === 'linux') ||
        ['note', 'added', 'flag'].some(key => key in feature && typeof feature[key] !== 'string') ||
        ('added' in feature && !/^\d{4}-\d{2}-\d{2}$/.test(feature.added)) ||
        ('pr' in feature && (!Number.isSafeInteger(feature.pr) || feature.pr <= 0)) ||
        ('docs' in feature && (!Array.isArray(feature.docs) || !feature.docs.every((doc: any) => typeof doc === 'string'))) ||
        ('config' in feature && (!Array.isArray(feature.config) ||
          !feature.config.every((c: any) => fields(c, ['key', 'value', 'does']) && strings(c, ['key', 'value', 'does'])))) ||
        ('shortcuts' in feature && (!Array.isArray(feature.shortcuts) ||
          !feature.shortcuts.every((s: any) => fields(s, ['keys', 'does']) && strings(s, ['keys', 'does']))))) throw Error('Unknown feature');
      ids.add(feature.id);
      const {note, ...rest} = feature;
      return rest;
    });
    return map;
  };
  try { return isDeepStrictEqual(strip(before), strip(after)); } catch { return false; }
}

export function macDecision(paths: string[] | null, nonModifications: string[] | null = [], notesOnly = false) {
  if (paths === null || nonModifications === null) return {macos: true, reasons: ['mac:unknown-history']};
  if (!paths.length) return {macos: true, reasons: ['mac:empty-delta']};
  const reasons = paths.map(path => {
    if (nonModifications.includes(path)) return `mac:unsupported-change:${path}`;
    if (portableSettings.has(path)) return `linux:reviewed-settings:${path}`;
    // Audited module chain: desktop/mod.rs cfg(linux) -> linux/capture/mod.rs.
    // Mac native build/packaging do not consume this source or Linux guide.
    if (path === portal || path === linuxDoc) return `linux:reviewed-portal-input:${path}`;
    if (path === featureMap && notesOnly) return `linux:feature-notes-only:${path}`;
    return `mac:unproven-input:${path}`;
  });
  // Include every unsafe input even if a caller supplied an incomplete path list.
  for (const path of nonModifications) if (!paths.includes(path)) reasons.push(`mac:unsupported-change:${path}`);
  return {macos: reasons.some(reason => reason.startsWith('mac:')), reasons};
}

export function requiresMac(paths: string[] | null, nonModifications: string[] | null = []): boolean {
  return macDecision(paths, nonModifications).macos;
}

type Change = {path: string; status: string; oldMode: string; newMode: string; oldBlob: string; newBlob: string};
const git = (args: string[]) => execFileSync('git', args,
  {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});

function changes(base: string, head: string): Change[] | null {
  if (!/^[a-f0-9]{40}$/.test(base) || /^0+$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) return null;
  try {
    if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') return null;
    git(['merge-base', '--is-ancestor', base, head]);
    const sharedPaths = inputPaths(base, head, process.cwd());
    // No rename folding: moving a file out of an owner must still select it.
    const raw = git(['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none',
      '--raw', '--no-abbrev', '-z', base, head, '--']);
    if (!raw) return sharedPaths.length ? null : [];
    const parts = raw.split('\0');
    if (parts.pop() !== '' || parts.length % 2 !== 0) return null;
    const result: Change[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const match = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([A-Z])$/.exec(parts[i]);
      if (!match || !parts[i + 1]) return null;
      const [, oldMode, newMode, oldBlob, newBlob, status] = match;
      result.push({path: parts[i + 1], status, oldMode, newMode, oldBlob, newBlob});
    }
    // Shared committed path facts remain authoritative for both consumers.
    // The Mac exemption additionally needs status/mode/blob proof; disagreement
    // cannot suppress any hosted check.
    return isDeepStrictEqual(sharedPaths, result.map(change => change.path)) ? result : null;
  } catch {
    // Missing history cannot suppress checks.
    return null;
  }
}

const unsupported = (change: Change) => change.status !== 'M' || change.oldMode !== '100644' || change.newMode !== '100644';

export function changedPaths(base: string, head: string, nonModificationsOnly = false): string[] | null {
  return changes(base, head)?.filter(change => !nonModificationsOnly || unsupported(change)).map(change => change.path) ?? null;
}

export function selectRange(base: string, head: string) {
  const delta = changes(base, head);
  const paths = delta?.map(change => change.path) ?? null;
  const metadata = delta?.find(change => change.path === featureMap && !unsupported(change));
  let notesOnly = false;
  if (metadata) try {
    const blob = (oid: string) => new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(
      execFileSync('git', ['cat-file', 'blob', oid], {maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}));
    notesOnly = featureNotesOnly(blob(metadata.oldBlob), blob(metadata.newBlob));
  } catch { /* Unreadable metadata cannot suppress Mac. */ }
  return {...select(paths), ...macDecision(paths, delta?.filter(unsupported).map(change => change.path) ?? null, notesOnly)};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.BASE_SHA ?? '';
  const head = process.env.GITHUB_SHA ?? '';
  const {reasons, ...result} = selectRange(base, head);
  console.log(JSON.stringify({...result, reasons}));
  appendFileSync(process.env.GITHUB_OUTPUT!, Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
}
