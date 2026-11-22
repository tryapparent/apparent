// Renderer request/readback controllers only. Shared validators, host workflows,
// cleanup policy, package/build inputs and new files retain native integration.
import {moduleImports} from '../fixture-portability/imports.ts';
import {parseManifest} from '../../../../shared/enablement/bend/manifest.ts';
import {isDeepStrictEqual} from 'node:util';

export const storageControllers = new Set([
  'record/storage/src/location-controller.ts',
  'record/storage/src/retention-controller.ts',
]);

export const recordBendManifest = 'record/enablement/ci/bend/modules.json';

function storageManifestMatches(json: string): boolean {
  const {modules, inputs} = parseManifest('record', json);
  const storageModules = modules.filter(path => path.startsWith('record/storage/'));
  const storageInputs = inputs.filter(path => path === 'record/storage' || path.startsWith('record/storage/'));
  return isDeepStrictEqual(storageModules.sort(), [
    'record/storage/src/retention/capacity.bend',
    'record/storage/src/retention/feedback.bend',
  ]) &&
    storageInputs.length === 1 && storageInputs[0] === 'record/storage/';
}

// Re-audit before accepting a changed native-consumer compile graph. This also
// catches an indirect ../index.js barrel import with no controller-name text.
export const nativeStorageGraph = new Map([
  ['capture/desktop/ui/frontend/scripts/build-storage-policy.ts', '68ba41e2318ffc477fb35c0ee60c453242490e9c'],
  ['record/storage/build.ts', 'ae0958975cc9643e6a5eec4a674a9815a38f462f'],
  ['record/storage/enablement/ci/bend/storage-default.ts', '22a37a4376729803777afd6b6554e3d638185788'],
  ['record/storage/tsconfig.json', '96d1a20c5109ff4e1996123a75730b7aa99b6165'],
  ['record/storage/package.json', 'a4af0bd9d619131db2423283f51c160d7c738bef'],
  ['record/storage/package-lock.json', '00f2fe49ea668718ef8e9d35ea7baa7236ce685b'],
  ['record/storage/src/index.ts', '4c621ae980623155f9f6989ffc0e503376d95328'],
  ['record/storage/src/location-contract.ts', '7ca220e3d9530dea8931473387a9704d329e10d0'],
  ['record/storage/src/location-policy.ts', 'bf45096ee826e7fc398fd0f93fada5ed7c194d7a'],
  ['record/storage/src/location-workflow.ts', 'd564377cd884dda1b0f4e9578d9afeaa0672f9c2'],
  ['record/storage/src/policy.ts', '0debd0cd97c2b1957b15ddfb6110c9fa16248853'],
  ['record/storage/src/retention-workflow.ts', 'cf4af06dd9022c15235f43a4082177bca0e049a0'],
  ['record/storage/src/retention/capacity.bend', '09a85f4fb32cd619e7d638d3559ae7aa4c934418'],
  ['record/storage/src/retention/capacity.d.mts', '491c67db5afb3080af0ab5e55f9c6a4440861d0c'],
  ['record/storage/src/retention/size-limit.ts', '5dfb1030aad58a71819ff9c99283b66023280c31'],
  ['record/storage/src/retention/feedback.bend', 'fabdd68c23dfe742751ad7be2810baaa160e396a'],
  ['record/storage/src/retention/feedback.d.mts', '169b18bc7f83d1da59398a0c203f5eaa78775f27'],
  ['record/storage/src/retention/policy.ts', 'e1d14cba2899eced97ec5336cac662940049fdbf'],
  ['record/storage/src/retention/worker.ts', 'e877069ab11b9c76893f3b991edf4b2cde25edfb'],
  ['record/storage/src/types.ts', 'deee255962414112168206f80bc600da57ddc425'],
  ['shared/enablement/bend/build.ts', '513b4899621933e5a13cafeeaddc43d5635ecd5e'],
  ['shared/enablement/bend/manifest.ts', '7657c844f0c9851aa21ae32641864160e034f0dd'],
  ['shared/enablement/bend/owners.ts', 'b527b1b063951f9f3184be594197dc2e5149e37a'],
  ['shared/enablement/bend/source.ts', '631b590a17498f515b693808782cf7539997806b'],
  ['shared/enablement/bend/toolchain.ts', 'eeaa26190ec44e9acfeac47153dccaa8d0f63158'],
]);

// The audited controllers use ordinary quoted strings/comments, no templates or
// regex literals. Unsupported lexical forms fail broad rather than hiding code.
function codeOnly(text: string): string | null {
  let code = '';
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === '`') return null;
    if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index); index = end < 0 ? text.length : end; code += ' '; continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2); if (end < 0) return null;
      index = end + 2; code += ' '; continue;
    }
    if (char === '/') return null;
    if (char === "'" || char === '"') {
      const quote = char; index++;
      while (index < text.length && text[index] !== quote) index += text[index] === '\\' ? 2 : 1;
      if (index >= text.length) return null;
      index++; code += ' '; continue;
    }
    code += char; index++;
  }
  return code;
}

function publicSurface(body: string): string[] | null {
  const code = codeOnly(body);
  if (code === null || /[`/]/.test(code)) return null;
  const start = code.indexOf('{');
  let depth = 1, member = '';
  const members: string[] = [];
  const capture = () => {
    const text = member.trim();
    if (text && !text.startsWith('#')) members.push(text);
    member = '';
  };
  for (let index = start + 1; index < code.length; index++) {
    const char = code[index];
    if (char === '{') {if (depth === 1) capture(); depth++;}
    else if (char === '}') {
      depth--;
      if (depth === 0) return code.slice(index + 1).trim() ? null : members;
    } else if (depth === 1) {
      if (char === ';') capture(); else member += char;
    }
  }
  return null;
}

// Every production reference to the package/controller names is audited. The
// selector supplies candidate Git references, including data-driven readers.
const storageReferences = new Set([
  ...storageControllers,
  ...nativeStorageGraph.keys(),
  'build.rs',
  'composition/enablement/ci/typecheck.json',
  'record/storage/test/controller.test.ts',
  'record/storage/renderer/size-limit.tsx',
  'capture/desktop/ui/frontend/package.json', 'capture/desktop/ui/frontend/package-lock.json', 'capture/desktop/ui/frontend/tsconfig.json',
  ...['scripts/settings-native/inputs.ts',
    'scripts/settings-native/inputs.test.ts', 'scripts/settings-native/provider.ts',
    'src/bridge.ts', 'src/storage.tsx', 'src/retention.tsx', 'src/storage/transport.ts']
    .map(path => 'capture/desktop/ui/frontend/' + path),
  'enablement/ci/routing/connect.test.ts', 'enablement/ci/routing/consumers.ts',
  'enablement/ci/select.ts', 'enablement/ci/select.test.ts',
  'enablement/ci/routing/record-storage/qualify.ts', 'enablement/ci/routing/record-storage/qualify.test.ts',
  'enablement/ci/routing/record-storage/range.test.ts',
  'enablement/local-tests/desktop-install.ts', 'enablement/local-tests/run.ts', 'enablement/local-tests/run.test.ts',
  'shared/enablement/bend/consumers.ts',
]);

export function storageGraphMatches(head: string, git: (args: string[]) => string): boolean {
  const references = git(['grep', '-I', '-l', '-E',
    'LocationController|RetentionController|record-storage|record/storage|/location-controller|/retention-controller',
    head, '--', ':!*.md']).trim().split('\n').map(line => line.slice(head.length + 1));
  const graph = git(['ls-tree', '-r', head, '--', ...nativeStorageGraph.keys()]).trim().split('\n').sort();
  const expectedGraph = [...nativeStorageGraph].map(([path, blob]) => `100644 blob ${blob}\t${path}`).sort();
  const manifest = git(['ls-tree', head, '--', recordBendManifest]).trim();
  return references.every(path => storageReferences.has(path)) && isDeepStrictEqual(graph, expectedGraph) &&
    manifest.startsWith('100644 blob ') && manifest.endsWith('\t' + recordBendManifest) &&
    storageManifestMatches(git(['show', head + ':' + recordBendManifest]));
}

// Keep the existing public ports and method signatures. This is an audited
// implementation boundary, not a TypeScript extension or protocol-shape exemption.
export function portableStorageController(path: string, before: string, after: string): boolean {
  if (!storageControllers.has(path)) return false;
  const className = path.includes('/location-') ? 'LocationController' : 'RetentionController';
  const expectedImports = className === 'LocationController'
    ? ['./types.js', './policy.js']
    : ['./types.js', './policy.js', './retention/feedback.mjs'];
  const inspect = (text: string) => {
    const marker = `export class ${className} {`;
    const start = text.indexOf(marker);
    if (start < 0 || text.indexOf(marker, start + marker.length) >= 0) return null;
    const imports = moduleImports(text);
    if (!imports || imports.length !== expectedImports.length || !expectedImports.every(name => imports.includes(name))) return null;
    const body = text.slice(start);
    // New execution/OS/DOM capabilities are not controller policy. Treat unknown
    // syntax conservatively; the ordinary package and renderer compiler still run.
    if (/\b(?:import|require)\s*[.(]|\b(?:process|globalThis|global|window|document|navigator|fetch|WebSocket|XMLHttpRequest|eval|Function)\b/.test(body)) return null;
    const signatures = publicSurface(body);
    if (!signatures?.length) return null;
    const code = codeOnly(body);
    if (code === null) return null;
    const calls = [...new Set([...code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
      .filter(match => code[match.index! - 1] !== '#').map(match => match[1]))].sort();
    return {contract: JSON.stringify({header: text.slice(0, start), signatures}), calls};
  };
  const original = inspect(before);
  const candidate = inspect(after);
  return original !== null && candidate !== null && original.contract === candidate.contract &&
    candidate.calls.every(name => original.calls.includes(name));
}
