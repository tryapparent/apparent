/** Integration proof requires a clean candidate and a genuinely sealed root receipt. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { admitRoot, assemble } from './composition.ts';
const digest = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const [rootDirectory, receipt, first, second] = ['ROOT_DIRECTORY', 'ROOT_RECEIPT', 'INSPECTOR_FIRST', 'INSPECTOR_SECOND'].map(k => {
  assert(process.env[k], `${k} required`); return resolve(process.env[k]!);
});
test('real packaged dispatch, inspector-only replacement, no Cargo and tamper failures', () => {
  const work = mkdtempSync(join(tmpdir(), 'inspection-composition-'));
  const originalPath = process.env.PATH;
  try {
    const bin = join(work, 'forbidden-build'); mkdirSync(bin);
    writeFileSync(join(bin, 'cargo'), '#!/bin/sh\nprintf "unexpected Cargo invocation" >&2\nexit 93\n', { mode: 0o755 });
    process.env.PATH = bin + ':' + originalPath;
    const rootHash = digest(join(rootDirectory, 'apparent'));
    const rootReceiptHash = digest(receipt);
    let componentHash: string | undefined;
    for (const [index, artifact] of [first, second].entries()) {
      const destination = join(work, `app-${index}`);
      const result = assemble(rootDirectory, receipt, rootReceiptHash, artifact, digest(artifact), destination);
      assert.equal(digest(join(destination, 'apparent')), rootHash);
      assert.equal(result.rootRebuilt, false);
      if (componentHash) assert.notEqual(result.inspectorRuntimeSha256, componentHash, 'Use genuinely different executables');
      componentHash = result.inspectorRuntimeSha256;
      const bundle = join(work, `current-${index}.apparent`); mkdirSync(bundle);
      writeFileSync(join(bundle, 'apparent.json'), readFileSync(fileURLToPath(new URL('../tests/fixtures/current.json', import.meta.url))));
      const env = { ...process.env, HOME: work, APPARENT_CAPTURES_DIR: work };
      for (const flags of [[], ['--json'], ['--marks'], ['--marks', '--json'], ['--experiment', 'agentContext']]) {
        const app = spawnSync(join(destination, 'apparent'), ['inspect', bundle, ...flags], { cwd: work, env, encoding: 'utf8' });
        const component = spawnSync(join(destination, 'inspection/apparent-inspect'), [bundle, ...flags], { cwd: work, env, encoding: 'utf8' });
        assert.equal(app.status, 0, app.stderr); assert.equal(app.stdout, component.stdout); assert.equal(app.stderr, component.stderr);
      }
      const before = readFileSync(join(bundle, 'apparent.json'));
      writeFileSync(join(destination, 'inspection/apparent-inspect'), 'tampered');
      const failure = spawnSync(join(destination, 'apparent'), ['inspect', bundle], { cwd: work, env, encoding: 'utf8' });
      assert.equal(failure.status, 1); assert.match(failure.stderr, /digest mismatch/);
      assert.deepEqual(readFileSync(join(bundle, 'apparent.json')), before);
      assert.throws(() => assemble(rootDirectory, receipt, '0'.repeat(64), artifact, digest(artifact), join(work, 'bad')), /receipt digest/);
    }
    const changed = JSON.parse(readFileSync(receipt, 'utf8')); changed.inputs[0].sha256 = '0'.repeat(64);
    const forged = join(work, 'changed-inputs.json'); writeFileSync(forged, JSON.stringify(changed));
    assert.throws(() => admitRoot(rootDirectory, forged, digest(forged)), /inventory changed/);
    console.log(JSON.stringify({ rootSha256: rootHash, rootRebuilt: false, realInspectorArtifacts: [digest(first), digest(second)], cases: 10 }));
  } finally { process.env.PATH = originalPath; rmSync(work, { recursive: true }); }
});
