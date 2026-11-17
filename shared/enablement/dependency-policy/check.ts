import {spawnSync} from 'node:child_process';
import {analyze} from './policy.ts';
import {Snapshot, git} from './snapshot.ts';

try {
  const cwd = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const tree = git(['write-tree'], cwd).trim(); // fails on an unmerged index
  const ref = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {cwd, encoding: 'utf8'});
  if (ref.error || (ref.status !== 0 && ref.status !== 1)) throw new Error('Cannot read HEAD baseline');
  const head = ref.status === 0 ? ref.stdout.trim() : undefined;
  const committed = new Snapshot(cwd, head);
  const staged = new Snapshot(cwd, tree);
  const baseline = analyze(committed);
  const candidate = analyze(staged);
  for (const file of staged.modes.keys()) if (file.startsWith('capture/') && !committed.modes.has(file))
    candidate.add(`${file}: capture/ is frozen; put new files and inbound relocations in desktop/, agent/ or engine/`);
  const added = [...candidate].filter(edge => !baseline.has(edge));
  if (added.length) {
    console.error('Dependency policy: new forbidden or unsupported edges in the staged snapshot:\n' + added.sort().map(e => '  ' + e).join('\n'));
    console.error('Use the allowed owner’s public exports, or stage the missing source/config/dependency declaration. Existing committed debt is tolerated.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error('Dependency policy failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
