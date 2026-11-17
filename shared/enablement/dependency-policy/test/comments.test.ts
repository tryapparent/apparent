import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {comments} from '../comments.ts';
const tool=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(tool,'../../..');
function fixture(t: any) {
  const dir=mkdtempSync('/tmp/apparent-dev-comments-');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const git=(...args: string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['pipe','pipe','pipe']});
  const put=(file: string,text: string)=>{mkdirSync(path.dirname(path.join(dir,file)),{recursive:true});if (/\.(?:[cm]?[jt]sx?|css|jsonc?)$/.test(file)) {
    const formatted=spawnSync(path.join(tool,'node_modules/.bin/biome'),['format','--config-path='+path.join(tool,'guards/biome.json'),'--stdin-file-path='+file,'--write'],{input:text,encoding:'utf8'});
    if(formatted.status===0) text=formatted.stdout;
  } writeFileSync(path.join(dir,file),text);};
  git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
  put('.githooks/pre-commit',readFileSync(path.join(root,'.githooks/pre-commit'),'utf8'));
  chmodSync(path.join(dir,'.githooks/pre-commit'),0o755);
  put('enablement/directory-width/check.py',readFileSync(path.join(root,'enablement/directory-width/check.py'),'utf8'));
  mkdirSync(path.join(dir,'shared/enablement'),{recursive:true});
  symlinkSync(tool,path.join(dir,'shared/enablement/dependency-policy'),'dir');
  git('config','core.hooksPath','.githooks');
  git('add','-A');git('-c','core.hooksPath=/dev/null','commit','-qm','trusted tool fixture');
  const stage=()=>git('add','-A');
  const baseline=()=>{stage();git('-c','core.hooksPath=/dev/null','commit','--allow-empty','-qm','legacy baseline');};
  const check=(pattern?: RegExp)=>{
    const r=spawnSync('sh',['.githooks/pre-commit'],{cwd:dir,encoding:'utf8'});
    if(pattern){assert.notEqual(r.status,0,r.stdout+r.stderr);assert.match(r.stdout+r.stderr,pattern);}
    else assert.equal(r.status,0,r.stdout+r.stderr);
  };
  return {git,put,stage,baseline,check};
}
test('parser distinguishes literals, regex, JSX, template substitutions and directives',async()=>{
  const text='const url="https://x/*no*/"; const re=/https?:\\/\\//; const t=`// no ${1 /* yes */}`; const x=<p>https://x {/* jsx */}</p>; /** doc */\n// @ts-ignore\nconst y=1;';
  assert.deepEqual(await comments('a.tsx',text),['/* yes */','/* jsx */','/** doc */','// @ts-ignore']);
  assert.deepEqual(await comments('a.py','s = "# literal"\n"""docstring"""\n# comment\n'),['# comment']);
  assert.deepEqual(await comments('a.rs','let s = r###"/* literal */"###; /* outer /* inner */ end */\n/// doc\n'),['/* outer /* inner */ end */','/// doc']);
  assert.deepEqual(await comments('a.swift','let s = "// literal"\n/** doc */\n'),['/** doc */']);
  assert.deepEqual(await comments('a.sh','#!/bin/sh\nprintf "%s" "# string"\ncat <<\'END\'\n# literal\nEND\n# comment\n'),['# comment']);
  assert.deepEqual(await comments('a.css','a { content: "/* no */"; /* yes */ }'),['/* yes */']);
  assert.deepEqual(await comments('a.yml','a: "# no" # yes\nb: |\n  # literal\n'),['# yes']);
  assert.deepEqual(await comments('a.toml','a = "# no" # yes\n'),['# yes']);
  assert.deepEqual(await comments('a.jsonc','{"a":"// no" /* yes */}'),['/* yes */']);
  assert.deepEqual(await comments('a.md','// prose\n<!-- prose -->'),[]);
});
test('new comments and changes fail; unchanged, moved and deleted legacy comments pass',t=>{
  const f=fixture(t);f.put('record/a.ts','// old\nexport const x=1;');f.baseline();f.check();
  f.put('record/a.ts','export const x=2;\n// old');f.stage();f.check();
  f.put('record/a.ts','// changed\nexport const x=2;');f.stage();f.check(/added\/changed code comment/);
  f.put('record/a.ts','export const x=2;');f.stage();f.check();
  f.put('record/a.ts','// old\n// old\nexport const x=2;');f.stage();f.check(/code comment/);
});
test('partial staging, new files, directives and real git commit rejection',t=>{
  const f=fixture(t);f.baseline();
  f.put('record/a.ts','export const x="// text";');f.stage();f.put('record/a.ts','// unstaged');f.check();
  f.stage();f.put('record/a.ts','export {};');f.check(/code comment/);
  f.put('record/a.ts','// eslint-disable-next-line\nexport {};');f.stage();
  assert.throws(()=>f.git('commit','-qm','reject directive'),/Staged comment policy/);
});
test('rename transfers allowance once; copies and additional comments fail',t=>{
  const f=fixture(t);f.put('record/a.ts','// legacy\nexport const x=1;\nexport const y=2;');f.baseline();
  f.git('mv','record/a.ts','record/b.ts');f.check();
  f.put('record/c.ts','// legacy\nexport const x=1;\nexport const y=2;');f.stage();f.check(/code comment/);
  f.git('rm','-f','record/c.ts');
  f.put('record/b.ts','// legacy\n// new\nexport const x=1;\nexport const y=2;');f.stage();f.check(/code comment/);
});
test('outbound migration carries comments, including unparseable unsupported unchanged blobs',t=>{
  const f=fixture(t);f.put('capture/engine/a.rs','// legacy\npub fn a() {}');f.put('old.sql','-- legacy');f.baseline();
  f.put('engine/README.md','Owner');f.git('mv','capture/engine/a.rs','engine/a.rs');f.check();
  f.put('old.sql','SELECT 1;');f.stage();f.check(/unsupported comment syntax/);
  f.git('rm','-f','old.sql');f.check();
});
test('unsupported and invalid changed files fail closed; language additions fail',t=>{
  const f=fixture(t);f.baseline();f.put('new.sql','SELECT 1;');f.stage();f.check(/unsupported comment syntax/);
  f.git('rm','-f','new.sql');f.put('hermes/a.py','def broken(:');f.stage();f.check(/syntax parser/);
});
test('named root allowances do not exempt arbitrary roots or nested width',t=>{
  const f=fixture(t);
  for(let i=0;i<8;i++) f.put(`other-${i}/a.txt`,'x');
  f.put('agent/README.md','Owner');f.put('handoff/README.md','Owner');f.stage();f.check();
  f.put('extra/a.txt','x');f.stage();f.check(/directory-width/);
  f.git('rm','-f','extra/a.txt');
  for(let i=0;i<11;i++) f.put(`agent/wide/${i}.txt`,'x');
  f.stage();f.check(/directory-width/);
});
test('Swift unsupported raw strings and embedded HTML fail safely; directives are comments',async()=>{
  await assert.rejects(comments('a.swift','let s = #"// raw"#\n'),/syntax parser/);
  await assert.rejects(comments('a.html','<script>const x=1; // comment\n</script>'),/embedded HTML/);
  assert.deepEqual(await comments('a.swift','/// doc\nlet x=1; // source directive\n'),['/// doc','// source directive']);
  assert.deepEqual(await comments('a.ts','//# sourceMappingURL=x\n// @ts-expect-error\nconst x=1;'),['//# sourceMappingURL=x','// @ts-expect-error']);
});
test('extensionless executable syntax selects real grammar and ignores only shebang',async()=>{
  assert.deepEqual(await comments('hook','#!/usr/bin/env python3\nx = "# no"\n# yes\n'),['# yes']);
  assert.deepEqual(await comments('hook','#!/usr/bin/env node\nconst x = /\\/\\//; // yes\n'),['// yes']);
  await assert.rejects(comments('hook','unclassified code'),/unsupported comment syntax/);
});
