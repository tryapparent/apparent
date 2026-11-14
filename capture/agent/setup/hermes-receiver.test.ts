import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { setup, main, system, type Provider } from './hermes.ts';

function fixture(platform = 'linux') {
  const profile = mkdtempSync('/tmp/apparent-dev-hermes-receiver-');
  const calls: { exe: string; args: string[]; home?: string }[] = [];
  const state = { enabled: false, metadata: undefined as string | undefined, failed: false, missingFetch: false, doctor: true };
  const p: Provider = { platform, home: '/unused', env: {}, run(exe, args, options) {
    calls.push({ exe, args, home: options?.hermesHome });
    if (exe === '/test/apparent') {
      assert.equal(options, undefined);
      assert.deepEqual(args.slice(1), ['--help']);
      assert(['inspect', 'fetch'].includes(args[0]));
      return { ok: !(state.missingFetch && args[0] === 'fetch'), output: `Usage: apparent ${args[0]} [OPTIONS]` };
    }
    assert.equal(exe, '/test/hermes');
    assert.equal(options?.hermesHome, profile);
    if (args[0] === '--version') return { ok: true, output: 'Hermes Agent v0.23.1 (2026.9.24)' };
    if (args[0] === 'config') {
      assert.deepEqual(args.slice(0, 2), ['config', 'get']);
      assert(['plugins.enabled', 'plugins.disabled'].includes(args[2]));
      return { ok: true, output: state.metadata ?? JSON.stringify(args[2] === 'plugins.enabled' && state.enabled ? ['apparent'] : []) };
    }
    if (args[1] === 'enable') {
      assert.deepEqual(args, ['plugins', 'enable', 'apparent']);
      if (!state.failed) state.enabled = true;
      return { ok: !state.failed, output: 'Human-readable activation output is not readiness evidence.' };
    }
    assert.deepEqual(args, ['plugins', 'doctor', 'apparent', '--ci']);
    return { ok: state.doctor, output: '' };
  } };
  const install = () => {
    const plugin = join(profile, 'plugins/apparent'); mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, '__init__.py'), 'def register(ctx): pass\n');
    writeFileSync(join(plugin, 'compatibility.json'), JSON.stringify({ schema: 1, plugin: 'apparent', version: '0.3.0', hermes: '>=0.23.0', platforms: ['linux', 'darwin'] }));
  };
  const run = (check = true, options = {}) => setup(p, '/test/apparent', profile, check, undefined, undefined, { receiver: true, hermesExecutable: '/test/hermes', ...options });
  return { profile, calls, state, p, install, run, close: () => rmSync(profile, { recursive: true, force: true }) };
}

test('headless receiver checks separate Apparent from Hermes and never require desktop/capture', () => {
  for (const platform of ['linux', 'darwin']) {
    const f = fixture(platform);
    try {
      f.install(); const report = f.run();
      assert.equal(report.prerequisitesReady, false);
      assert.equal(report.setupReady, false, 'disabled is not set up');
      assert.equal(report.ready, false);
      assert.equal(report.checks.find(c => c.id === 'plugin-enabled')?.status, 'unknown');
      assert.equal(report.checks.find(c => c.id === 'plugin-session')?.status, 'unknown');
      assert(f.calls.every(c => c.exe === '/test/apparent'));
      assert(!report.checks.some(c => ['capture', 'url-handler', 'running', 'plugin-desktop'].includes(c.id)));
    } finally { f.close(); }
  }
});

test('explicit activation is profile scoped and idempotent, without tool override grants or runtime import', () => {
  const f = fixture();
  try {
    f.install(); const report = f.run(false, { enable: true });
    assert.equal(report.setupReady, true);
    assert.equal(report.ready, false, 'enabled metadata cannot prove a session tool');
    assert.equal(report.repairs[0].status, 'applied');
    f.run(false, { enable: true });
    assert.equal(f.calls.filter(c => c.args[1] === 'enable').length, 1);
    assert(!f.calls.some(c => c.args[1] === 'doctor'));
  } finally { f.close(); }
});

test('failed activation and malformed activation readback remain unresolved', () => {
  const f = fixture();
  try {
    f.install(); f.state.failed = true;
    assert.equal(f.run(false, { enable: true }).repairs[0].status, 'failed');
    for (const metadata of ['not json', '{}', '[{"name":"apparent","status":"enabled"},{"name":"apparent","status":"enabled"}]', '[{"name":"apparent","status":"enabled","removed":{"reason":"recalled"}}]']) {
      f.state.metadata = metadata; const count = f.calls.filter(c => c.args[1] === 'enable').length;
      const report = f.run(false, { enable: true });
      assert.equal(report.setupReady, false);
      assert.equal(f.calls.filter(c => c.args[1] === 'enable').length, count);
    }
  } finally { f.close(); }
});

test('missing package and old CLI without fetch do not activate', () => {
  const f = fixture();
  try {
    assert.equal(f.run(false, { enable: true }).setupReady, false);
    f.install(); f.state.missingFetch = true;
    assert.equal(f.run(false, { enable: true }).checks.find(c => c.id === 'receiver-cli')?.status, 'incompatible');
    assert(!f.calls.some(c => c.args[1] === 'enable'));
  } finally { f.close(); }
});

test('runtime preparation is bounded and failed or old Hermes never activates', () => {
  for (const version of [{ ok: false, output: '' }, { ok: true, output: 'Hermes Agent v0.22.0' }]) {
    const f = fixture();
    try {
      f.install(); const base = f.p.run;
      f.p.run = (exe, args, options) => {
        if (args[0] === '--version') {
          assert.equal(options?.timeoutMs, 180000);
          return version;
        }
        return base(exe, args, options);
      };
      const result = f.run(false, { enable: true, verifyRuntime: true });
      assert.equal(result.setupReady, false);
      assert(!f.calls.some(c => ['enable', 'doctor'].includes(c.args[1])));
    } finally { f.close(); }
  }
});

test('registration requires explicit repair mode and enabled prerequisites; never proves current session', () => {
  const f = fixture();
  try {
    f.install(); assert.throws(() => f.run(true, { verifyRuntime: true }), /repair mode/);
    assert.throws(() => f.run(true, { enable: true }), /repair mode/);
    f.run(false, { verifyRuntime: true }); assert(!f.calls.some(c => c.args[1] === 'doctor'));
    const report = f.run(false, { enable: true, verifyRuntime: true });
    assert.equal(report.checks.find(c => c.id === 'plugin-registration')?.status, 'ok');
    assert.equal(report.checks.find(c => c.id === 'plugin-session')?.status, 'unknown');
    assert.equal(report.ready, false);
    f.state.doctor = false;
    assert.equal(f.run(false, { verifyRuntime: true }).checks.find(c => c.id === 'plugin-registration')?.status, 'incompatible');
  } finally { f.close(); }
});

test('receiver requires explicit profile and supported platform even through the policy API', () => {
  const f = fixture();
  try {
    assert.throws(() => setup(f.p, '/test/apparent', undefined, true, undefined, undefined, { receiver: true }), /requires --profile/);
    assert.throws(() => setup(f.p, '/test/apparent', 'relative', true, undefined, undefined, { receiver: true }), /ABSOLUTE/);
    assert.throws(() => main(['--receiver', '--check', '--enable', '--profile', f.profile], f.p), /--check/);
  } finally { f.close(); }
});

test('profile override preserves unrelated process environment through the real subprocess provider', () => {
  const old = process.env.APPARENT_SETUP_FIXTURE;
  try {
    process.env.APPARENT_SETUP_FIXTURE = 'preserved';
    const result = system.run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify([process.env.HERMES_HOME,process.env.APPARENT_SETUP_FIXTURE]))'], { hermesHome: '/synthetic/profile' });
    assert.equal(result.ok, true);
    assert.deepEqual(JSON.parse(result.output), ['/synthetic/profile', 'preserved']);
  } finally {
    if (old === undefined) delete process.env.APPARENT_SETUP_FIXTURE; else process.env.APPARENT_SETUP_FIXTURE = old;
  }
});

test('native-style argv keeps Apparent and Hermes executables distinct', () => {
  const f = fixture(); const previous = console.log; let output = '';
  try {
    f.install(); console.log = value => { output = String(value); };
    assert.equal(main(['--executable', '/test/apparent', '--receiver', '--json', '--profile', f.profile, '--hermes-executable', '/test/hermes'], f.p), 1);
    assert.equal(JSON.parse(output).role, 'receiver');
    assert(f.calls.some(c => c.exe === '/test/apparent'));
    assert(f.calls.some(c => c.exe === '/test/hermes'));
  } finally { console.log = previous; f.close(); }
});

test('unset lists are distinct from failed config reads, and explicit disabled state wins', () => {
  const f = fixture();
  try {
    f.install();
    const base = f.p.run;
    f.p.run = (exe, args, options) => args[0] === 'config' ? { ok: false, output: '', notSet: true } : base(exe, args, options);
    assert.equal(f.run(false).checks.find(c => c.id === 'plugin-enabled')?.status, 'absent');
    f.p.run = (exe, args, options) => args[0] === 'config' ? { ok: false, output: '' } : base(exe, args, options);
    assert.equal(f.run(false).checks.find(c => c.id === 'plugin-enabled')?.status, 'unknown');
    f.p.run = (exe, args, options) => args[0] === 'config' ? { ok: true, output: '["apparent"]' } : base(exe, args, options);
    assert.equal(f.run(false).checks.find(c => c.id === 'plugin-enabled')?.status, 'absent');
  } finally { f.close(); }
});


test('real subprocess adapter distinguishes exact missing config keys from failures', () => {
  const root = mkdtempSync('/tmp/apparent-dev-hermes-provider-');
  try {
    const exe = join(root, 'provider.ts');
    writeFileSync(exe, `#!${process.execPath}
const key = process.argv[4];
process.stderr.write(key === 'plugins.enabled' ? 'Config key not set: plugins.enabled' : 'transport failed');
process.exitCode = 1;
`);
    chmodSync(exe, 0o700);
    const missing = system.run(exe, ['config', 'get', 'plugins.enabled', '--json']);
    assert.deepEqual(missing, { ok: false, output: '', notSet: true });
    assert.deepEqual(system.run(exe, ['config', 'get', 'plugins.disabled', '--json']), { ok: false, output: '' });
    writeFileSync(exe, `#!${process.execPath}
setTimeout(() => {}, 10000);
`);
    assert.deepEqual(system.run(exe, ['config', 'get', 'plugins.enabled', '--json'], { hermesHome: root, timeoutMs: 20 }), { ok: false, output: '' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
