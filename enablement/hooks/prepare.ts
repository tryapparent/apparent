import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync,copyFileSync,mkdirSync,writeFileSync,readdirSync,lstatSync,chmodSync} from 'node:fs';
import path from 'node:path';

try {
  const args=process.argv.slice(2);
  const flags = args.slice(2);
  const retire = flags.includes('--retire-verified-line-guard');
  const retirePush = flags.includes('--retire-verified-cargo-push');
  if ((args.length < 2 || new Set(flags).size !== flags.length || flags.some(flag => !['--retire-verified-line-guard', '--retire-verified-cargo-push'].includes(flag))) || args[0] !== '--output' || !path.isAbsolute(args[1])) throw new Error('Usage: node --experimental-strip-types enablement/hooks/prepare.ts --output /absolute/new/private/hook-directory [--retire-verified-line-guard] [--retire-verified-cargo-push]');
  const output=args[1];
  const git=(...args: string[])=>execFileSync('git',args,{encoding:'utf8'}).trim();
  const root=git('rev-parse','--show-toplevel');
  const active=git('-C',root,'rev-parse','--path-format=absolute','--git-path','hooks');
  const config=spawnSync('git',['config','--show-origin','--get','core.hooksPath'],{encoding:'utf8'});
  if (config.error || ![0,1].includes(config.status!)) throw new Error('Cannot discover active hook configuration');
  const origin=config.status === 0 ? config.stdout.trim() : 'default Git hooks directory (no explicit core.hooksPath)';
  const hooks=readdirSync(active).filter(name=>!name.endsWith('.sample'));
  for (const name of ['preserved-pre-commit','preserved-pre-push','preserved-prepare-commit-msg','preserved-commit-msg','provenance.json']) if (hooks.includes(name)) throw new Error(`Reserved preparation entry already active: ${name}; review existing composition before preparing again`);
  for (const name of hooks) if (!lstatSync(path.join(active,name)).isFile()) throw new Error(`Unsupported existing hook entry: ${name}; preserve it manually before activation`);
  const legacy = path.join(active,'pre-commit');
  const fingerprint = hooks.includes('pre-commit') ? createHash('sha256').update(readFileSync(legacy)).digest('hex') : undefined;
  if (retire && fingerprint !== '170a84654e64035afc5cafffa8a2387c6814f4c4315cc2250ae15e9333d664ed') throw new Error('Legacy guard does not match the verified standalone Python line guard; preserve/review customized hooks manually');
  const pushFingerprint = hooks.includes('pre-push') ? createHash('sha256').update(readFileSync(path.join(active,'pre-push'))).digest('hex') : undefined;
  if (retirePush && pushFingerprint !== '8ba11032d420497f232f1096b6b8e52356abf5be264e7c18610eba888f95e920') throw new Error('Legacy pre-push does not match the verified full-Cargo hook; preserve/review customized hooks manually');
  const backupName = (name: string) => ['pre-commit','prepare-commit-msg','commit-msg'].includes(name) || (name === 'pre-push' && retirePush) ? 'preserved-' + name : name;
  mkdirSync(output,{mode:0o700});
  for (const name of hooks) copyFileSync(path.join(active,name),path.join(output,backupName(name)));
  const quote=(s: string)=>"'"+s.replaceAll("'","'\\''")+"'";
  let wrapper='#!/bin/sh\nset -eu\n';
  if (hooks.includes('pre-commit') && !retire) wrapper+=`${quote(path.join(output,'preserved-pre-commit'))} "$@"\n`;
  wrapper+='root=$(git rev-parse --show-toplevel)\nexec "$root/.githooks/pre-commit" "$@"\n';
  writeFileSync(path.join(output,'pre-commit'),wrapper,{mode:0o755});
  for (const name of hooks) chmodSync(path.join(output,backupName(name)),lstatSync(path.join(active,name)).mode & 0o777);
  if (retirePush || !hooks.includes('pre-push')) writeFileSync(path.join(output,'pre-push'), '#!/bin/sh\nset -eu\nroot=$(git rev-parse --show-toplevel)\nexec "$root/.githooks/pre-push" "$@"\n', {mode:0o755});
  for (const [name, command] of [['prepare-commit-msg','prepare-message'], ['commit-msg','validate-message']]) {
    let messageHook = '#!/bin/sh\nset -eu\n';
    if (hooks.includes(name)) messageHook += quote(path.join(output, 'preserved-' + name)) + ' "$@"\n';
    messageHook += 'root=$(git rev-parse --show-toplevel)\nexec node --experimental-strip-types "$root/shared/enablement/issues/run.ts" ' + command + ' "$1"\n';
    writeFileSync(path.join(output,name),messageHook,{mode:0o755});
  }
  writeFileSync(path.join(output,'provenance.json'),JSON.stringify({active,origin,retiredLegacyLineGuard:retire,retiredLegacyCargoPush:retirePush,prePushSha256:pushFingerprint,prePushBackup:retirePush ? "preserved-pre-push" : null,preCommitSha256:fingerprint,backup:'preserved-pre-commit'},null,2)+'\n',{mode:0o600});
  console.log(`Prepared ${output}. Existing hooks backed up (verified LOC guard omitted only when explicitly requested) from ${active}; pre-push delegates to the current worktree when absent or explicitly retired, otherwise its existing bytes are preserved. No configuration was changed. Review and test this candidate, then coordinate activation with the parent. Active configuration origin:\n${origin}`);
} catch(error) {
  console.error('Hook preparation failed:',error instanceof Error ? error.message : error);
  process.exitCode=1;
}
