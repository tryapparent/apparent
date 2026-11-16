import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modules, modulePaths, verifyDependencies } from './nss-runtime.ts';

test('rejects the historical incomplete NSS closure, accepts all modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'nss-'));
  try {
    writeFileSync(join(root, 'libnss3.so'), 'bundled NSS');
    writeFileSync(join(root, 'libnssutil3.so'), 'bundled NSS util');
    assert.throws(() => modulePaths(root), /libsoftokn3/);
    for (const name of modules) writeFileSync(join(root, name), 'fixture');
    assert.deepEqual(modulePaths(root), modules.map(name => join(root, name)));
    rmSync(join(root, 'libfreeblpriv3.so'));
    assert.throws(() => modulePaths(root), /libfreeblpriv3/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('rejects unresolved relocations and host NSS fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'nss-'));
  try {
    assert.throws(() => verifyDependencies('libnssutil3.so => not found', root), /Incomplete/);
    assert.throws(() => verifyDependencies('undefined symbol: NSSUTIL_X', root), /Incomplete/);
    writeFileSync(join(root, 'libnssutil3.so'), 'fixture');
    verifyDependencies(`libnssutil3.so => ${root}/libnssutil3.so (0x1)`, root);
    assert.throws(() => verifyDependencies('libnssutil3.so => /usr/lib/x86_64-linux-gnu/libnssutil3.so (0x1)', root), /escaped/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
