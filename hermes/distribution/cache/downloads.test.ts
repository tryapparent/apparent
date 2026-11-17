import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {cacheKey, snapshot} from './downloads.ts';

async function job(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(process.env.TMPDIR || '/tmp', 'apparent-dev-hermes-cache-'));
  try { await run(root); } finally { await rm(root, {recursive: true, force: true}); }
}

test('cache keys invalidate every dependency, toolchain, platform and policy input', () => {
  const inputs = {lock: 'producer lock', project: 'producer project', workflow: 'install policy',
    helper: 'snapshot policy', upstream: 'commit', uv: '0.12.13', python: '3.14.0', os: 'macOS', arch: 'X64'};
  const key = cacheKey(inputs);
  for (const name of Object.keys(inputs)) assert.notEqual(cacheKey({...inputs, [name]: inputs[name] + '-changed'}), key, name);
  assert.equal(cacheKey(Object.fromEntries(Object.entries(inputs).reverse())), key);
  assert.notEqual(cacheKey({a: 'bc'}), cacheKey({ab: 'c'}));
});

test('snapshot keeps only downloaded wheel objects and relative links; excludes mutable/native state', async () => job(async root => {
  const cache = path.join(root, 'cache'), out = path.join(root, 'downloads');
  const index = path.join(cache, 'wheels-v6/pypi/example');
  await mkdir(index, {recursive: true});
  await mkdir(path.join(cache, 'archive-v0/downloaded'), {recursive: true});
  await writeFile(path.join(cache, 'archive-v0/downloaded/module.py'), 'wheel content');
  await symlink('../../../archive-v0/downloaded', path.join(index, '1-py3-none-any'));
  await writeFile(path.join(index, '1-py3-none-any.msgpack'), 'metadata');
  for (const excluded of ['sdists-v9', 'builds-v0', 'environments-v2', 'interpreter-v4', 'git-v0', 'profile', '.venv', 'node_modules', 'archive-v0/unreferenced-build']) {
    await mkdir(path.join(cache, excluded), {recursive: true});
    await writeFile(path.join(cache, excluded, 'private'), 'must not persist');
  }
  await snapshot(cache, out);
  assert.deepEqual((await readdir(out)).sort(), ['archive-v0', 'wheels-v6']);
  assert.deepEqual(await readdir(path.join(out, 'archive-v0')), ['downloaded']);
  assert.equal(await readFile(path.join(out, 'wheels-v6/pypi/example/1-py3-none-any/module.py'), 'utf8'), 'wheel content');
  assert.equal(await readlink(path.join(out, 'wheels-v6/pypi/example/1-py3-none-any')), '../../../archive-v0/downloaded');
  await assert.rejects(snapshot(cache, out), {code: 'EEXIST'});
  await symlink(root, path.join(index, 'escape'));
  await assert.rejects(snapshot(cache, path.join(root, 'hostile')), /Invalid wheel archive/);
}));

test('CLI key binds actual fetched dependency bytes and this workflow/helper', async () => job(async root => {
  const workflow = path.join(root, 'workflow.yml'), output = path.join(root, 'output');
  await writeFile(path.join(root, 'uv.lock'), 'lock');
  await writeFile(path.join(root, 'pyproject.toml'), 'dependencies');
  await writeFile(workflow, 'policy');
  function key() {
    execFileSync(process.execPath, ['--experimental-strip-types', 'hermes/distribution/cache/downloads.ts', 'key', root, workflow, output],
      {env: {...process.env, VALIDATOR_IDENTITY: 'upstream|uv 0.12.13|3.14.0|macOS|X64|macos-15-intel'}});
  }
  key(); await writeFile(path.join(root, 'uv.lock'), 'new lock'); key();
  await writeFile(path.join(root, 'pyproject.toml'), 'new dependencies'); key();
  await writeFile(workflow, 'new policy'); key();
  const keys = (await readFile(output, 'utf8')).trim().split('\n');
  assert.equal(new Set(keys).size, 4);
}));

test('snapshot refuses unsupported layouts and links inside wheel payloads', async () => job(async root => {
  const cache = path.join(root, 'cache'); await mkdir(cache);
  await assert.rejects(snapshot(cache, path.join(root, 'unknown-layout')), {code: 'ENOENT'});
  const index = path.join(cache, 'wheels-v6/pypi/example'); await mkdir(index, {recursive: true});
  const archive = path.join(cache, 'archive-v0/wheel'); await mkdir(archive, {recursive: true});
  await symlink('../../../archive-v0/wheel', path.join(index, '1-py3-none-any'));
  await symlink(root, path.join(archive, 'outside'));
  await assert.rejects(snapshot(cache, path.join(root, 'linked-payload')), /Nonregular wheel content/);
}));

test('workflow caches downloads only and always performs fresh frozen install and exact candidate validation', async () => {
  const workflow = await readFile('.github/workflows/hermes.yml', 'utf8');
  const prepare = workflow.slice(workflow.indexOf('- name: Prepare pinned Hermes validator'), workflow.indexOf('- name: Validate installed package'));
  assert.match(prepare, /job=\/tmp\/apparent-dev-hermes-validator-ci\n\s+mkdir -m 700 "\$job"/);
  assert.match(prepare, /rev-parse HEAD\)" = a867bb03fb35d4727ff0e9e2c0527745d4ff27cc/);
  assert.match(prepare, /UV_CACHE_DIR="\$JOB\/cache" uv sync.*--frozen --no-dev --link-mode copy/);
  assert.match(prepare, /test ! -e "\$JOB\/runtime\/\.venv"/);
  assert.equal((prepare.match(/path: \/tmp\/apparent-dev-hermes-validator-ci\/downloads/g) || []).length, 2);
  assert.doesNotMatch(prepare, /restore-keys:|pull_request_target|if:.*cache-hit.*true'\n\s+.*uv sync/);
  assert.match(prepare, /PYTHON_VERSION: \$\{\{ steps.validator-python.outputs.python-version \}\}/);
  assert.match(prepare, /\$\(uv --version\)\|\$PYTHON_VERSION\|\$\{\{ runner.os \}\}\|\$\{\{ runner.arch \}\}/);
  const validation = workflow.slice(workflow.indexOf('- name: Validate installed package'), workflow.indexOf('- uses: actions/upload-artifact'));
  assert.doesNotMatch(validation, /if:|cache-hit/);
  for (const command of ['mktemp -d /tmp/apparent-dev-hermes-profile-XXXXXX', 'export HERMES_HOME="$job/profile"',
    'shasum -a 256 -c ./*.sha256', 'node "$job/extracted/install.cjs" --profile "$HERMES_HOME"',
    'hermes plugins validate "$HERMES_HOME/plugins/apparent" --install-deps', 'hermes plugins doctor "$HERMES_HOME/plugins/apparent" --ci']) assert.ok(validation.includes(command), command);
  assert.match(workflow, /os: \[ubuntu-24.04\]/);
});

// Opt-in network proof uses uv's real producer-generated lock/index/archive format.
// This is cache compatibility evidence, not Hermes or Mac native acceptance.
test('real pinned uv: cold wheel download -> snapshot -> offline install in a fresh Python 3.14 venv',
  {skip: process.env.HERMES_DOWNLOAD_PROOF !== '1'}, async () => job(async root => {
    assert.match(execFileSync('uv', ['--version'], {encoding: 'utf8'}), /^uv 0\.12\.13 /);
    const source = path.join(root, 'source'), fresh = path.join(root, 'fresh');
    await mkdir(source); await mkdir(fresh);
    await writeFile(path.join(source, 'pyproject.toml'), '[project]\nname="cache-proof"\nversion="0.0.0"\nrequires-python=">=3.14"\ndependencies=["six==1.17.0"]\n');
    const cache = path.join(root, 'cold-cache'), downloads = path.join(root, 'downloads'), warm = path.join(root, 'warm-cache');
    const env = {...process.env, UV_CACHE_DIR: cache};
    execFileSync('uv', ['lock', '--project', source, '--python', '3.14'], {env});
    execFileSync('uv', ['sync', '--project', source, '--python', '3.14', '--frozen', '--no-dev', '--link-mode', 'copy'], {env});
    await snapshot(cache, downloads);
    for (const file of ['uv.lock', 'pyproject.toml']) await cp(path.join(source, file), path.join(fresh, file));
    await rm(source, {recursive: true}); await rm(cache, {recursive: true});
    await assert.rejects(stat(path.join(fresh, '.venv')), {code: 'ENOENT'});
    await cp(downloads, warm, {recursive: true, verbatimSymlinks: true});
    execFileSync('uv', ['sync', '--project', fresh, '--python', '3.14', '--frozen', '--no-dev', '--offline', '--link-mode', 'copy'], {env: {...env, UV_CACHE_DIR: warm}});
    assert.equal(execFileSync(path.join(fresh, '.venv/bin/python'), ['-c', 'import six; print(six.__version__)'], {encoding: 'utf8'}).trim(), '1.17.0');
    assert.deepEqual((await readdir(downloads)).sort(), ['archive-v0', 'wheels-v6']);
  }));
