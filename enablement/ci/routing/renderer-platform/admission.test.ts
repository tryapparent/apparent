import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, chmodSync, symlinkSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {YAML} from 'bun';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const frontend = 'capture/desktop/ui/frontend/';
const cards = ['storage', 'retention', 'error-reporting', 'reference'].map(name => frontend + 'src/' + name + '.tsx');
const seams = [frontend + 'src/style.css', frontend + 'electron/main.cjs', frontend + 'electron/preload.cjs',
  frontend + 'src/storage/transport.ts', frontend + 'src/onboarding/permissions.tsx', frontend + 'package.json',
  'capture/desktop/scripts/packaging/install-app.sh', 'capture/desktop/settings/settings.rs'];
const workflow = (name: string) => YAML.parse(readFileSync(join(root, '.github/workflows', name), 'utf8')) as any;
const ci = workflow('checks.yml'), platform = workflow('verification-platform.yml');

// Evaluate the actual workflow conditions, including GitHub's implicit success().
function enabled(expression: string, needs: any, event = 'pull_request', draft = false, cancelled = false, inputs: any = {}) {
  if (!/\b(always|cancelled|success|failure)\s*\(/.test(expression) && Object.values(needs).some((n: any) => n.result !== 'success')) return false;
  return !!Function('needs', 'github', 'inputs', 'cancelled', 'fromJSON', `return (${expression});`)(needs,
    {event_name: event, event: {pull_request: {draft}}}, inputs, () => cancelled, JSON.parse);
}
const parents = (outputs: any) => ({select: {result: 'success', outputs}, contracts: {result: 'success'},
  reuse: {result: 'success', outputs: {}}, portable: {result: 'success'}, 'record-media': {result: 'success'}});

function fixture(action: (git: (...args: string[]) => string, dir: string, env: NodeJS.ProcessEnv) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'apparent-dev-renderer-admission-'));
  const env = {...process.env};
  for (const key of execFileSync('git', ['rev-parse', '--local-env-vars'], {encoding: 'utf8'}).trim().split('\n')) delete env[key];
  const git = (...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args],
    {cwd: dir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  try {
    git('init', '-qb', 'main'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'ci@example.invalid');
    for (const path of [...cards, ...seams]) {mkdirSync(join(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), readFileSync(join(root, path)));}
    git('add', '.'); git('commit', '-qm', 'actual renderer source baseline');
    action(git, dir, env);
  } finally {rmSync(dir, {recursive: true, force: true});}
}

// Run the real producer consumed by today's workflow. Assert the output wiring
// too: checking selectRange().macos alone cannot prove runner admission.
function outputs(dir: string, env: NodeJS.ProcessEnv, base: string, head: string, event: string, admit = true) {
  const output = join(dir, '.git', 'output'); writeFileSync(output, '');
  const common = {...env, BASE_SHA: base, GITHUB_SHA: head, GITHUB_EVENT_NAME: event,
    GITHUB_REF: event === 'push' ? 'refs/heads/main' : 'refs/pull/1/merge', GITHUB_OUTPUT: output};
  assert.equal(ci.jobs.select.steps.find((step: any) => step.id === 'paths').run, 'bun enablement/ci/select.ts --admit');
  for (const name of ['macos', 'mac_rust', 'mac_plan', 'plan', 'platform'])
    assert.equal(ci.jobs.select.outputs[name], '${{ steps.paths.outputs.' + name + ' }}', name);
  execFileSync('bun', [join(root, 'enablement/ci/select.ts'), ...(admit ? ['--admit'] : [])],
    {cwd: dir, env: common, stdio: ['ignore', 'pipe', 'pipe']});
  return Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => {const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];}));
}

for (const path of cards) test('finite card modification avoids Mac allocation but retains Linux: ' + path, () => fixture((git, dir, env) => {
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, path), readFileSync(join(root, path), 'utf8') + '\n// Synthetic renderer modification.\n');
  git('commit', '-qam', 'renderer edit'); const head = git('rev-parse', 'HEAD');
  for (const event of ['pull_request', 'push']) {
    const result = outputs(dir, env, base, head, event), needs = parents(result);
    assert.equal(result.macos, 'false');
    assert.equal(enabled(ci.jobs.macos.if, needs, event), false, 'actual Mac caller must skip');
    assert.equal(enabled(ci.jobs.linux.if, needs, event), true);
    const plan = JSON.parse(result.plan), macPlan = JSON.parse(result.mac_plan);
    assert.equal(plan.root, true); assert.equal(plan.desktop, true);
    for (const key of ['root', 'engine', 'desktop', 'client']) assert.equal(macPlan[key], false, key);
    // If the reusable workflow is invoked accidentally, its fallback must not
    // reallocate a Mac from a stale Desktop flag.
    const projected = Object.fromEntries(Object.entries(macPlan).map(([key, value]) => [key, String(value)]));
    assert.equal(enabled(platform.jobs.rust.if, {select: {result: 'success', outputs: projected}}, event, false, false,
      {runner: 'macos-15-intel', release_receipt: false, mac_rust: false}), false);
    const admission = spawnSync('bun', [join(root, 'enablement/ci/routing/evidence.ts'), '--admit'], {cwd: dir, env: {...env,
      VERIFY_PLATFORM: 'macos', VERIFICATION_PLAN: result.plan, MAC_VERIFICATION_PLAN: result.mac_plan,
      CI_NEEDS: JSON.stringify({...needs, macos: {result: 'skipped'}})}, encoding: 'utf8'});
    assert.equal(admission.status, 0, admission.stderr);
    for (const guard of ['contracts', 'portable', 'record-media']) {
      const failed = structuredClone(needs); failed[guard].result = 'failure';
      assert.equal(enabled(ci.jobs.linux.if, failed, event), false);
    }
  }
}));

test('mixed native, platform seams, unknown renderer and unsafe changes retain Mac allocation', () => fixture((git, dir, env) => {
  const base = git('rev-parse', 'HEAD'), card = cards[1];
  for (const path of [...seams, frontend + 'src/unknown.tsx', frontend + 'src/connect-settings.tsx']) {
    git('checkout', '--detach', base);
    writeFileSync(join(dir, card), readFileSync(join(root, card), 'utf8') + '\n// Mixed modification.\n');
    mkdirSync(join(dir, path, '..'), {recursive: true}); writeFileSync(join(dir, path), seams.includes(path)
      ? readFileSync(join(root, path), 'utf8') + '\n/* Synthetic seam modification. */\n' : 'unproven input');
    git('add', '.'); git('commit', '-qm', 'mixed seam');
    const result = outputs(dir, env, base, git('rev-parse', 'HEAD'), 'pull_request');
    assert.equal(enabled(ci.jobs.macos.if, parents(result)), true, path);
  }
  for (const operation of ['delete', 'rename', 'chmod', 'symlink']) {
    git('checkout', '--detach', base);
    if (operation === 'delete') git('rm', card);
    if (operation === 'rename') git('mv', card, card + '.moved');
    if (operation === 'chmod') chmodSync(join(dir, card), 0o755);
    if (operation === 'symlink') {unlinkSync(join(dir, card)); symlinkSync('elsewhere', join(dir, card));}
    git('add', '.'); git('commit', '-qm', operation);
    const result = outputs(dir, env, base, git('rev-parse', 'HEAD'), 'pull_request', false);
    assert.equal(enabled(ci.jobs.macos.if, parents(result)), true, operation);
  }
}));

test('unknown selector, partial outputs and Darwin inputs fail closed after cheap guards', () => {
  for (const outputs of [{}, {platform: 'true'}, {platform: 'true', macos: 'true', mac_rust: 'false'}]) {
    const needs = parents(outputs);
    assert.equal(enabled(ci.jobs.macos.if, needs), true);
    needs.select.result = 'failure'; assert.equal(enabled(ci.jobs.macos.if, needs), true);
    assert.equal(enabled(ci.jobs.macos.if, needs, 'pull_request', true), false);
    assert.equal(enabled(ci.jobs.macos.if, needs, 'pull_request', false, true), false);
    needs.contracts.result = 'failure'; assert.equal(enabled(ci.jobs.macos.if, needs), false);
  }
});

test('Linux keeps complete policy and renderer proof; manual Mac and Darwin seams retain their commands', () => {
  const steps = platform.jobs['desktop-ui'].steps;
  assert.ok(steps.some((step: any) => step.if === "runner.os == 'Linux'" && step.run === 'npm test'));
  assert.ok(steps.some((step: any) => step.if === "runner.os == 'Linux'" && step.run === 'xvfb-run -a npm run test:electron'));
  const scripts = JSON.parse(readFileSync(join(root, frontend, 'package.json'), 'utf8')).scripts;
  for (const keeper of ['tests/retention-smoke.cjs', 'tests/storage-smoke.cjs', 'tests/connect/smoke.cjs', 'tests/electron-smoke.cjs']) assert.ok(scripts['test:electron'].includes(keeper), keeper);
  for (const seam of ['src/hermes/runtime.smoke.ts', 'tests/pill/foreground/smoke.cts']) {
    assert.ok(scripts['test:electron:mac'].includes(seam));
    assert.match(readFileSync(join(root, frontend, seam), 'utf8'), /process.platform\s*===\s*'darwin'/);
  }
  assert.equal(platform.on.workflow_call.inputs.mac_rust.default, true);
  assert.equal(platform.on.workflow_call.inputs.release_receipt.default, true);
});
