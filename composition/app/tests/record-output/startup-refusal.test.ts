import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmsForeignOwner, ForeignOwnerRefusal, isPreOwnershipRefusal, persistStartupFailure, hasReviewedGuiRefusalContract } from '../../src/record/omarchy/startup-refusal.ts';
import { buildOmarchyPackage } from '../../scripts/build-omarchy.ts';

const actual = { executableSha256: '9768f559f97b10e40b3efa348c54f220a87242794529d3d4fce37ace1b1e18d0',
  stderr: 'Error: native-host-only requires its own GUI owner\n', truncated: false,
  exitCode: 1, signal: null, profileWorkAbsent: true };
// Closed GUI73f6/c81/33 package manifest. The source-bound package check also
// verifies this against the actual AppImage member, not only this test value.
const currentGui = '2dbee5bcc778eb02c724ab3b9169f95784c976a54baaf75ca5042d08ea02bea2';
test('current packaged GUI preserves only the same exact pre-owner refusal contract', () => {
  const current = {...actual, executableSha256:currentGui};
  assert.equal(hasReviewedGuiRefusalContract(currentGui),true);
  assert.equal(hasReviewedGuiRefusalContract('a'.repeat(64)),false);
  assert.equal(confirmsForeignOwner(current), true);
  for(const change of [{profileWorkAbsent:false},{exitCode:null},{exitCode:0},{signal:'SIGTERM'},
    {truncated:true},{stderr:'Error: native-host-only requires its own GUI owner after initialization\n'},
    {stderr:'Error: Apparent is already running; native-host-only requires its own GUI owner\n'},
    {stderr:'Error: another Apparent GUI is running; update and restart it first\n'},
    {stderr:actual.stderr.repeat(2)},{executableSha256:'a'.repeat(64)}])
    assert.equal(confirmsForeignOwner({...current,...change}),false);
});
test('Linux complete-package preflight rejects an unreviewed GUI before output or native reads', async () => {
  if(process.platform!=='linux'||process.arch!=='x64')return;
  const root=mkdtempSync(join(tmpdir(),'gui-refusal-package-'));
  try{
    const output=join(root,'must-not-exist');
    const unavailable={directory:join(root,'no-native'),manifestSha256:'0'.repeat(64),sourceSha:'0'.repeat(40)};
    await assert.rejects(buildOmarchyPackage(output,{target:'linux-x64',capture:unavailable,media:unavailable,config:unavailable,
      gui:{path:join(root,'must-not-read'),sha256:'0'.repeat(64),executableSha256:'a'.repeat(64),sourceSha:'0'.repeat(40)}}),/startup-refusal contract must be reviewed/);
    assert.equal(existsSync(output),false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('retained X1 pre-owner refusal requires reviewed executable, complete stderr, confirmed exit and absent profile work', () => {
  assert.equal(confirmsForeignOwner(actual), true);
  for (const change of [{ executableSha256: '0'.repeat(64) }, { exitCode: 0 }, { exitCode: null },
    { signal: 'SIGTERM' }, { truncated: true }, { profileWorkAbsent: false },
    { stderr: 'Native GUI readiness timed out' }, { stderr: actual.stderr.repeat(2) }]) {
    assert.equal(confirmsForeignOwner({ ...actual, ...change }), false);
  }
  assert.equal(isPreOwnershipRefusal(new Error(actual.stderr)), false);
  assert.equal(isPreOwnershipRefusal({ name: 'ForeignOwnerRefusal' }), false);
  assert.equal(isPreOwnershipRefusal(new ForeignOwnerRefusal()), true);
});
test('private startup evidence survives without serializing child handles and refuses symlink writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'startup-evidence-'));
  try {
    persistStartupFailure(root, new ForeignOwnerRefusal());
    const path = join(root, 'startup-diagnostic.log');
    assert.match(readFileSync(path, 'utf8'), /Another Apparent is running/);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    rmSync(path); const target = join(root, 'unrelated'); writeFileSync(target, 'preserve'); symlinkSync(target, path);
    assert.throws(() => persistStartupFailure(root, new Error('failed')));
    assert.equal(readFileSync(target, 'utf8'), 'preserve');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
