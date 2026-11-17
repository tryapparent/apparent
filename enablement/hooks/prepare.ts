import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,writeFileSync,readdirSync,lstatSync,chmodSync} from 'node:fs';
import path from 'node:path';

try {
  const args=process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output' || !path.isAbsolute(args[1])) throw new Error('Usage: node --experimental-strip-types enablement/hooks/prepare.ts --output /absolute/new/private/hook-directory');
  const output=args[1];
  const git=(...args: string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
  const root=git('rev-parse','--show-toplevel');
  const active=git('-C',root,'rev-parse','--path-format=absolute','--git-path','hooks');
  const config=spawnSync('git',['config','--show-origin','--get','core.hooksPath'],{encoding:'utf8'});
  if (config.error || ![0,1].includes(config.status!)) throw new Error('Cannot discover active hook configuration');
  const origin=config.status === 0 ? config.stdout.trim() : 'default Git hooks directory (no explicit core.hooksPath)';
  const hooks=readdirSync(active).filter(name=>!name.endsWith('.sample'));
  for (const name of hooks) if (!lstatSync(path.join(active,name)).isFile()) throw new Error(`Unsupported existing hook entry: ${name}; preserve it manually before activation`);
  mkdirSync(output,{mode:0o700});
  for (const name of hooks) copyFileSync(path.join(active,name),path.join(output,name === 'pre-commit' ? 'preserved-pre-commit' : name));
  const quote=(s: string)=>"'"+s.replaceAll("'","'\\''")+"'";
  let wrapper='#!/bin/sh\nset -eu\n';
  if (hooks.includes('pre-commit')) wrapper+=`${quote(path.join(output,'preserved-pre-commit'))} "$@"\n`;
  wrapper+=`exec ${quote(path.join(root,'.githooks/pre-commit'))} "$@"\n`;
  writeFileSync(path.join(output,'pre-commit'),wrapper,{mode:0o755});
  for (const name of hooks) chmodSync(path.join(output,name === 'pre-commit' ? 'preserved-pre-commit' : name),lstatSync(path.join(active,name)).mode & 0o777);
  console.log(`Prepared ${output}. Existing hooks preserved from ${active}; pre-push copied unchanged. No configuration was changed. Review and test this candidate, then coordinate activation with the parent. Active configuration origin:\n${origin}`);
} catch(error) {
  console.error('Hook preparation failed:',error instanceof Error ? error.message : error);
  process.exitCode=1;
}
