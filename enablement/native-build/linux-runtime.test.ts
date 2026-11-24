import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(import.meta.dirname, '../..');
const buildScript = readFileSync(join(root, 'build.rs'), 'utf8');

function productionStager(): string {
  const start = buildScript.indexOf('fn stage_transcribe_shared_objects()');
  assert.notEqual(start, -1, 'production Linux runtime stager must exist');
  const open = buildScript.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < buildScript.length; i++) {
    if (buildScript[i] === '{') depth++;
    if (buildScript[i] === '}' && --depth === 0)
      return buildScript.slice(start, i + 1);
  }
  assert.fail('production Linux runtime stager must be balanced');
}

test('Linux runtime staging follows both Cargo output layouts to the binary and test directories', t => {
  const dir = mkdtempSync(join(tmpdir(), 'apparent-dev-linux-layout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'main.rs');
  const staging = join(dir, 'staging');
  writeFileSync(source, `use std::path::PathBuf;\n${productionStager()}\nfn main() { stage_transcribe_shared_objects(); }\n`);
  const compile = spawnSync('rustc', ['--edition=2024', source, '-o', staging], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(compile.status, 0, String(compile.error ?? compile.stderr));

  const runtime = join(dir, 'runtime');
  const modules = join(dir, 'modules');
  mkdirSync(runtime);
  mkdirSync(modules);
  writeFileSync(join(runtime, 'libtranscribe.so.0.2'), 'synthetic runtime');
  writeFileSync(join(modules, 'libggml-cpu-x64.so'), 'synthetic backend');
  writeFileSync(join(runtime, 'not-a-library.txt'), 'exclude');
  const layouts = [
    ['legacy/debug', 'apparent-hash/out'],
    ['current/custom-profile', 'apparent/hash/out'],
  ];
  for (const [profilePath, layout] of layouts) {
    const profile = join(dir, profilePath);
    const output = join(profile, 'build', layout);
    mkdirSync(output, { recursive: true });
    const result = spawnSync(staging, [], {
      cwd: dir, encoding: 'utf8', timeout: 30_000,
      env: {
        PATH: '',
        OUT_DIR: output,
        DEP_TRANSCRIBE_CPP_RUNTIME_DIR: runtime,
        DEP_TRANSCRIBE_CPP_MODULE_DIR: modules,
      },
    });
    assert.equal(result.status, 0, `${layout}: ${result.error ?? result.stderr}`);
    for (const destination of [profile, join(profile, 'deps')]) {
      assert.equal(readFileSync(join(destination, 'libtranscribe.so.0.2'), 'utf8'), 'synthetic runtime');
      assert.equal(readFileSync(join(destination, 'libggml-cpu-x64.so'), 'utf8'), 'synthetic backend');
      assert.equal(existsSync(join(destination, 'not-a-library.txt')), false);
    }
  }
});

test('Cargo reruns production runtime staging after cached shared objects are pruned', { skip: process.platform !== 'linux' }, t => {
  const dir = mkdtempSync(join(tmpdir(), 'apparent-dev-linux-runtime-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const provider = join(dir, 'provider');
  const modules = join(dir, 'modules');
  mkdirSync(provider);
  mkdirSync(modules);
  const compile = (name: string, value: string) => {
    const source = join(dir, `${name}.c`);
    writeFileSync(source, `int ${name}() { return ${value}; }\n`);
    const result = spawnSync('cc', ['-shared', '-fPIC', source, '-o', join(name === 'transcribe' ? provider : modules, `lib${name}.so`)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  compile('transcribe', '42');
  compile('ggml_cpu', '7');

  const manifest = join(dir, 'Cargo.toml');
  writeFileSync(manifest, '[package]\nname="runtime-cache-proof"\nversion="0.1.0"\nedition="2024"\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/main.rs'), '#[link(name="transcribe")] unsafe extern "C" { fn transcribe() -> i32; }\nfn main() { assert_eq!(unsafe { transcribe() }, 42); }\n');
  writeFileSync(join(dir, 'build.rs'), `use std::path::PathBuf;\n${productionStager()}\nfn main() {\n stage_transcribe_shared_objects();\n let out = PathBuf::from(std::env::var_os("OUT_DIR").unwrap());\n let profile = out.ancestors().nth(3).unwrap();\n println!("cargo:rustc-link-search=native={}", profile.join("deps").display());\n println!("cargo:rustc-link-lib=dylib=transcribe");\n println!("cargo:rustc-link-arg=-Wl,-rpath,$ORIGIN/deps");\n}\n`);

  const env = { ...process.env, CARGO_TARGET_DIR: join(dir, 'target'), DEP_TRANSCRIBE_CPP_RUNTIME_DIR: provider, DEP_TRANSCRIBE_CPP_MODULE_DIR: modules };
  const cargoRun = () => spawnSync('cargo', ['run', '--offline', '--manifest-path', manifest], { cwd: dir, env, encoding: 'utf8', timeout: 120_000 });
  const first = cargoRun();
  assert.equal(first.status, 0, first.stderr);
  const requireFresh = () => {
    const unchanged = cargoRun();
    assert.equal(unchanged.status, 0, unchanged.stderr);
    assert.doesNotMatch(unchanged.stderr, /Compiling runtime-cache-proof/, 'no-edit Cargo run must stay fresh');
  };
  requireFresh();
  const target = join(dir, 'target/debug');
  for (const name of ['libtranscribe.so', 'libggml_cpu.so']) {
    assert.ok(existsSync(join(target, name)), `${name} staged beside production binaries`);
    assert.ok(existsSync(join(target, 'deps', name)), `${name} staged beside Cargo test binaries`);
  }

  // Model a restored Cargo build-script cache whose target runtime files were pruned.
  for (const name of ['libtranscribe.so', 'libggml_cpu.so']) {
    rmSync(join(target, name));
    rmSync(join(target, 'deps', name));
  }
  const recovered = cargoRun();
  assert.equal(recovered.status, 0, recovered.stderr);
  requireFresh();
  for (const name of ['libtranscribe.so', 'libggml_cpu.so']) {
    assert.ok(existsSync(join(target, name)), `${name} restaged beside production binaries`);
    assert.ok(existsSync(join(target, 'deps', name)), `${name} restaged beside Cargo test binaries`);
  }
});
