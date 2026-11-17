import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tool = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(tool, '../../..');
function fixture(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), 'apparent-dev-deps-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const git = (...args: string[]) => execFileSync('git', args, {cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
  const put = (file: string, text: string) => {mkdirSync(path.dirname(path.join(dir, file)), {recursive: true}); writeFileSync(path.join(dir, file), text);};
  git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
  // Exercise the actual hook and width implementation, with the installed checker linked as trusted tooling.
  put('.githooks/pre-commit', readFileSync(path.join(repo, '.githooks/pre-commit'), 'utf8'));
  chmodSync(path.join(dir, '.githooks/pre-commit'), 0o755);
  put('enablement/directory-width/check.py', readFileSync(path.join(repo, 'enablement/directory-width/check.py'), 'utf8'));
  mkdirSync(path.join(dir, 'shared/enablement'), {recursive: true});
  symlinkSync(tool, path.join(dir, 'shared/enablement/dependency-policy'), 'dir');
  put('enablement/hooks/lines.ts',readFileSync(path.join(repo,'enablement/hooks/lines.ts'),'utf8'));
  git('config', 'core.hooksPath', '.githooks');
  git('add', '-A'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'trusted tool fixture');
  const stage = () => git('add', '-A');
  const commit = () => git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'baseline');
  const hook = () => spawnSync('sh', ['.githooks/pre-commit'], {cwd: dir, encoding: 'utf8'});
  const pass = () => {const r = hook(); assert.equal(r.status, 0, r.stdout + r.stderr);};
  const fail = (pattern: RegExp) => {const r = hook(); assert.notEqual(r.status, 0, r.stdout + r.stderr); assert.match(r.stderr + r.stdout, pattern);};
  return {dir, git, put, stage, commit, pass, fail};
}
test('parser forms, owner policy and exact-edge debt ratchet', t => {
  const f = fixture(t);
  f.put('engine/api.ts', 'export const x = 1');
  f.put('onboarding/a.ts', 'import type {x} from "../engine/api";');
  f.stage(); f.fail(/Onboarding to Engine/);
  f.commit(); f.pass(); // committed debt
  f.put('onboarding/a.ts', 'export const clean = true;');
  f.put('onboarding/b.ts', 'export type {x} from "../engine/api";');
  f.stage(); f.fail(/onboarding\/b.ts -> engine\/api.ts/); // same count, different importer
  f.put('onboarding/b.ts', 'export const clean = true;'); f.stage(); f.pass(); f.commit();
  f.put('onboarding/a.ts', 'const x = require("../engine/api");'); f.stage(); f.fail(/Onboarding to Engine/);
});
test('partial staging never reads candidate source from worktree; deletions allowed', t => {
  const f = fixture(t); f.put('engine/a.ts', 'export {}'); f.stage(); f.commit();
  f.put('agent/a.ts', 'export {}'); f.stage();
  f.put('agent/a.ts', 'import "../engine/a"'); f.pass();
  f.stage(); f.put('agent/a.ts', 'export {}'); f.fail(/Agent to Engine/);
  f.git('rm', '-f', 'agent/a.ts'); f.pass();
});
test('public exports allow Record layering, own internal code, Shared packages and Composition', t => {
  const f = fixture(t);
  for (const [dir, name] of [['engine/sdk','@app/engine'], ['record/api','@app/record'], ['shared/lib','@app/shared']]) {
    f.put(dir + '/package.json', JSON.stringify({name, exports: {'.': './index.ts'}}));
    f.put(dir + '/index.ts', 'export const x = 1');
  }
  f.put('record/a.ts', 'export {x} from "@app/engine"; import "../shared/lib/index";');
  f.put('agent/a.ts', 'import "@app/record"; import "../record/api/index";');
  f.put('onboarding/a.ts', 'import "./internal";');
  f.put('onboarding/internal.ts', 'export {}');
  f.put('composition/a.ts', 'import "@app/record"; import "@app/shared";');
  f.stage(); f.pass();
  f.put('record/api/private.ts', 'export {}');
  f.put('onboarding/a.ts', 'import "../record/api/private";'); f.stage(); f.fail(/non-public contract/);
});
test('forbidden siblings, Engine reverse dependencies, Shared product edges', t => {
  const f = fixture(t);
  f.put('record/a.ts','export {}'); f.put('connect/a.ts','export {}');
  f.put('public/a.js','export * from "../connect/a.js";');
  f.put('engine/a.ts','import "../record/a";');
  f.put('shared/a.ts','import("../record/a");');
  f.put('onboarding/a.cts','import x = require("../agent/a");');
  f.put('agent/a.ts','export = 1');
  f.stage(); f.fail(/Public to Connect/); f.fail(/Engine to Record/); f.fail(/Shared to Record/); f.fail(/Onboarding to Agent/);
});
test('staged alias config changes reevaluate unchanged sources, not worktree config', t => {
  const f = fixture(t);
  f.put('record/a.ts','import "alias";'); f.put('record/local.ts','export {}'); f.put('connect/a.ts','export {}');
  const config = (target: string) => JSON.stringify({compilerOptions:{baseUrl:'.',paths:{alias:[target]}}});
  f.put('record/tsconfig.json',config('local.ts')); f.stage(); f.commit(); f.pass();
  f.put('record/tsconfig.json',config('../connect/a.ts')); f.stage();
  f.put('record/tsconfig.json',config('local.ts')); f.fail(/Record to Connect/);
});
test('manifest exports change reevaluates unchanged consumers; dist needs no build', t => {
  const f = fixture(t);
  f.put('record/lib/package.json',JSON.stringify({name:'@app/record',exports:{'.':'./dist/index.js'}}));
  f.put('agent/a.ts','import "@app/record";'); f.stage(); f.commit(); f.pass();
  f.put('record/lib/package.json',JSON.stringify({name:'@app/record',exports:{'./other':'./dist/other.js'}}));
  f.stage(); f.fail(/non-public contract/);
});
test('unknown forms, syntax, symlinks, unresolved merges fail usefully', t => {
  const f = fixture(t); f.put('record/a.ts', 'import(getModule());'); f.stage(); f.fail(/non-literal/);
  f.put('record/a.ts', 'import "unknown-package";'); f.stage(); f.fail(/cannot resolve/);
  f.put('record/a.ts', 'const = ;'); f.stage(); f.fail(/syntax/);
  f.git('rm', '-f', 'record/a.ts'); mkdirSync(path.join(f.dir,'record'), {recursive:true}); symlinkSync('../connect/a.ts', path.join(f.dir,'record/a.ts')); f.stage(); f.fail(/unsupported Git mode/);
});
test('directory-width remains first and preserves rejection', t => {
  const f = fixture(t);
  for(let i=0;i<11;i++) f.put(`record/wide/${i}.ts`, 'export {}');
  f.put('record/a.ts', 'import "unknown"'); f.stage();
  const r = spawnSync('sh', ['.githooks/pre-commit'], {cwd:f.dir, encoding:'utf8'});
  assert.notEqual(r.status,0); assert.match(r.stderr+r.stdout,/width|limit/i);
  assert.doesNotMatch(r.stderr+r.stdout,/Dependency policy/);
});
test('rename is a new importer edge; removing and committing debt prevents reintroduction', t => {
  const f = fixture(t); f.put('engine/a.ts','export {}');
  f.put('record/a.ts','import "../engine/a";'); f.stage(); f.commit(); f.pass();
  f.git('mv','record/a.ts','record/b.ts'); f.fail(/record\/b.ts -> engine\/a.ts/);
  f.git('rm','-f','record/b.ts'); f.pass(); f.commit();
  f.put('record/a.ts','import "../engine/a";'); f.stage(); f.fail(/record\/a.ts -> engine\/a.ts/);
});
test('inherited staged config and computed requires have bounded diagnostics', t => {
  const f = fixture(t);
  f.put('record/base.json',JSON.stringify({compilerOptions:{baseUrl:'.',paths:{lib:['local.ts']}}}));
  f.put('record/tsconfig.json','{"extends":"./base.json"}');
  f.put('record/local.ts','export {}'); f.put('record/a.ts','import "lib";');
  f.stage(); f.commit(); f.pass();
  f.put('record/base.json','{"extends":"./missing.json"}'); f.stage(); f.fail(/missing.json/);
});
test('unmerged index fails rather than inspecting worktree conflict text', t => {
  const f = fixture(t); f.put('record/a.ts','export {}'); f.stage(); f.commit();
  const hash = f.git('rev-parse', 'HEAD:record/a.ts').trim();
  execFileSync('git',['update-index','--index-info'],{cwd:f.dir,input:`0 ${'0'.repeat(40)}\trecord/a.ts\n100644 ${hash} 1\trecord/a.ts\n100644 ${hash} 2\trecord/a.ts\n100644 ${hash} 3\trecord/a.ts\n`});
  f.fail(/unmerged|write-tree|stage/i);
});
test('declared external and builtins pass; JS runtime forms cannot hide cross-owner edges', t => {
  const f = fixture(t);
  f.put('record/package.json','{"dependencies":{"external-lib":"1.0.0"}}');
  f.put('record/a.mjs','import "external-lib"; import "fs"; import "node:path";'); f.stage(); f.commit(); f.pass();
  f.put('connect/a.ts','export {}');
  f.put('record/a.mjs','const p = import(`../connect/a`);'); f.stage(); f.fail(/Record to Connect/);
  f.put('record/a.mjs','require.resolve("../connect/a");'); f.stage(); f.fail(/Record to Connect/);
});
test('all capture paths are frozen: additions, inbound renames and copies fail', t => {
  const f = fixture(t);
  f.put('capture/mod.rs','// legacy'); f.put('capture/ui_process.rs','// legacy');
  f.put('capture/desktop/ui/frontend/src/onboarding/a.ts','export {}'); f.put('capture/agent/a.ts','export {}');
  f.put('capture/engine/a.ts','export {}'); f.put('onboarding/a.ts','export {}');
  f.stage(); f.commit(); f.pass();
  f.put('capture/mod.rs','// legacy\nfn repair() {}'); f.put('capture/desktop/ui/frontend/src/onboarding/a.ts','export const fix = 1;'); f.stage(); f.pass();
  f.put('capture/unknown/new.rs','fn new_file() {}'); f.stage(); f.fail(/capture\/unknown\/new.rs: capture\/ is frozen/);
  f.git('rm','-f','capture/unknown/new.rs');
  f.git('mv','onboarding/a.ts','capture/new.ts'); f.fail(/capture\/new.ts: capture\/ is frozen/);
  f.git('mv','capture/new.ts','onboarding/a.ts');
  f.put('capture/copied.ts','export {}'); f.stage(); f.fail(/capture\/copied.ts: capture\/ is frozen/);
  f.git('rm','-f','capture/copied.ts');
  f.git('mv','capture/desktop/ui/frontend/src/onboarding/a.ts','onboarding/migrated.ts');
  f.git('rm','-f','capture/mod.rs','capture/ui_process.rs'); f.pass();
});
test('destination and legacy paths retain identical owners', t => {
  const f = fixture(t);
  f.put('capture/desktop/ui/frontend/src/onboarding/a.ts','export {}'); f.put('capture/agent/a.ts','export {}'); f.stage(); f.commit();
  f.put('onboarding/a.ts','import "../capture/desktop/ui/frontend/src/onboarding/a";');
  f.put('agent/a.ts','import "../capture/agent/a";'); f.stage(); f.pass();
  f.put('onboarding/a.ts','import "../agent/a";'); f.stage(); f.fail(/Onboarding to Agent/);
});
test('exports patterns honor null private exclusions and aliases cannot publish private targets', t => {
  const f = fixture(t);
  f.put('engine/lib/package.json',JSON.stringify({name:'@app/engine',exports:{'./*':'./src/*.ts','./private':null}}));
  f.put('engine/lib/src/public.ts','export {}'); f.put('engine/lib/src/private.ts','export {}');
  f.put('record/a.ts','import "@app/engine/public";'); f.stage(); f.commit(); f.pass();
  f.put('record/a.ts','import "../engine/lib/src/private";'); f.stage(); f.fail(/non-public contract/);
  f.put('record/tsconfig.json', JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'@app/engine/public':['../engine/lib/src/private.ts']}}}));
  f.put('record/a.ts','import "@app/engine/public";'); f.stage(); f.fail(/non-public contract/);
});
test('git commit itself invokes the executable pre-commit guard', t => {
  const f = fixture(t); f.stage(); f.git('commit','--allow-empty','-qm','initial hook');
  f.put('capture/new.rs','// forbidden new legacy file'); f.stage();
  assert.throws(() => f.git('commit','-qm','must reject'), /capture\/ is frozen/);
});
test('public exports do not grant sibling or transitive capability permissions', t => {
  const f=fixture(t);
  for(const name of ['onboarding','record','handoff','connect','agent','engine','shared']) {
    f.put(`${name}/api/package.json`,JSON.stringify({name:`@app/${name}`,exports:{'.':'./index.ts'}}));
    f.put(`${name}/api/index.ts`,'export const x=1;');
  }
  f.stage();f.commit();
  for(const [from,to] of [['onboarding','record'],['handoff','connect'],['handoff','record'],['agent','engine'],['record','connect'],['connect','handoff'],['engine','agent'],['composition','engine']]) {
    f.put(`${from}/consumer.ts`,`import "@app/${to}";`);f.stage();f.fail(new RegExp(`${from[0].toUpperCase()+from.slice(1)} to ${to[0].toUpperCase()+to.slice(1)}`));
    f.git('rm','-f',`${from}/consumer.ts`);
  }
  f.put('agent/a.ts','import "@app/record"; import "@app/shared";');
  f.put('record/a.ts','import "@app/engine";');
  f.put('engine/a.ts','import "@app/shared";');
  f.put('composition/a.ts','import "@app/onboarding"; import "@app/handoff"; import "@app/connect";');
  f.stage();f.pass();
});
