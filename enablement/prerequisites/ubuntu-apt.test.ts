import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const action = readFileSync('.github/actions/ubuntu-apt/action.yml', 'utf8');
const shell = action.split('      run: |\n')[1].split('\n').map(line => line.replace(/^        /, '')).join('\n');
function run(t: any, content: string | null, os = 'Linux', environment = 'github-hosted') {
  const directory = mkdtempSync('/tmp/apparent-dev-apt-');
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const mirrors = join(directory, 'mirrors');
  if (content !== null) writeFileSync(mirrors, content);
  const bin = join(directory, 'bin'); mkdirSync(bin);
  // Only remove privilege elevation; run the production shell and real sed.
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n', {mode: 0o700});
  const result = spawnSync('bash', ['-e', '-c', shell.replace('/etc/apt/apt-mirrors.txt', mirrors)], {
    encoding: 'utf8', timeout: 5000, env: {...process.env, PATH: bin + ':' + process.env.PATH,
      RUNNER_OS: os, RUNNER_ENVIRONMENT: environment},
  });
  return {status: result.status, stderr: result.stderr, content: content === null ? null : readFileSync(mirrors, 'utf8')};
}
const fallback = 'https://archive.ubuntu.com/ubuntu/\nhttps://security.ubuntu.com/ubuntu/\n';
test('hosted mirror repair removes only Azure and preserves official and unrelated sources', t => {
  const other = '# azure.archive.ubuntu.com\nhttps://example.invalid/ubuntu/\n';
  const original = 'http://azure.archive.ubuntu.com/ubuntu/\nhttps://azure.archive.ubuntu.com/ubuntu\n' + fallback + other;
  const result = run(t, original);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.content, fallback + other);
  assert.equal(run(t, result.content).content, result.content, 'idempotent');
});
test('repair refuses a mirror list without an official fallback before changing it', t => {
  const original = 'http://azure.archive.ubuntu.com/ubuntu/\n';
  const result = run(t, original);
  assert.notEqual(result.status, 0);
  assert.equal(result.content, original);
});
test('other runner image layouts are unchanged', t => {
  assert.equal(run(t, null).status, 0);
  assert.equal(run(t, fallback).content, fallback);
});
for (const [os, environment] of [['Linux', 'self-hosted'], ['macOS', 'github-hosted']]) {
  test(`repair refuses ${os}/${environment} without writes`, t => {
    const original = 'http://azure.archive.ubuntu.com/ubuntu/\n' + fallback;
    const result = run(t, original, os, environment);
    assert.notEqual(result.status, 0);
    assert.equal(result.content, original);
  });
}
test('affected hosted jobs prepare mirrors before their first APT dependency installer', () => {
  const publicWorkflow = readFileSync('.github/workflows/stream-public.yml', 'utf8');
  const platform = readFileSync('.github/workflows/verification-platform.yml', 'utf8');
  for (const [source, installer] of [[publicWorkflow, 'Install Public\'s locked dependencies'],
    [platform.split('\n  desktop-ui:')[0], 'Install recipient media fixture dependency'],
    [platform.split('\n  rust:')[1], 'Linux application dependencies']]) {
    const setup = source.indexOf('uses: ./.github/actions/ubuntu-apt');
    assert.ok(setup >= 0 && setup < source.indexOf(installer), installer);
  }
});
