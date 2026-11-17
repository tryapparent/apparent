import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectRange} from '../select.ts';
import {routingProblems} from './consumers.ts';
import {selection} from '../../local-tests/run.ts';

test('Agent executable retirement requires the reviewed replacement and preserves native consumers', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'apparent-dev-agent-retirement-'));
  const donor = 'capture/agent/scripts/agent-eval.sh', replacement = 'capture/agent/enablement/context-comparison.ts';
  const accepted = readFileSync(new URL('../../../' + replacement, import.meta.url), 'utf8');
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  const put = (path: string, text: string) => {mkdirSync(join(cwd, path, '..'), {recursive: true}); writeFileSync(join(cwd, path), text);};
  try {
    git('init', '-q'); git('config', 'user.name', 'Synthetic'); git('config', 'user.email', 'synthetic@example.invalid');
    for (const path of [donor, donor + '.other']) {put(path, '#!/bin/sh\nexit 0\n'); chmodSync(join(cwd, path), 0o755);}
    git('add', '.'); git('commit', '-qm', 'baseline'); const base = git('rev-parse', 'HEAD');
    for (const scenario of ['accepted', 'missing', 'changed', 'symlink', 'modification', 'neighbor']) {
      git('reset', '--hard', base); git('clean', '-fdq');
      if (scenario === 'modification') put(donor, '#!/bin/sh\nexit 1\n');
      else git('rm', scenario === 'neighbor' ? donor + '.other' : donor);
      if (scenario !== 'missing') {
        put(replacement, accepted + (scenario === 'changed' ? '\n// changed\n' : ''));
        if (scenario === 'symlink') {rmSync(join(cwd, replacement)); symlinkSync('../comparison.ts', join(cwd, replacement));}
      }
      git('add', '.'); git('commit', '-qm', scenario); const head = git('rev-parse', 'HEAD');
      const hosted = selectRange(base, head, cwd), local = selection(base, head, cwd);
      assert.deepEqual(local.plan, hosted.plan, scenario); assert.deepEqual(local.reasons, hosted.reasons, scenario);
      assert.equal(hosted.inputProofKnown, scenario === 'accepted', scenario);
      assert.equal(hosted.plan.root, true, scenario);
      assert.equal(hosted.requiredStreams.engine, scenario !== 'accepted', scenario);
      assert.equal(hosted.plan.public, scenario !== 'accepted', scenario);
      assert.equal(hosted.plan.engine, true, scenario); assert.equal(hosted.macos, true, scenario);
      if (scenario === 'accepted') assert.deepEqual(routingProblems(hosted), []);
    }
  } finally {rmSync(cwd, {recursive: true, force: true});}
});
