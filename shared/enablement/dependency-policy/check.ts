import type {Edge} from "./runtime/contexts.ts";
import {validateTools} from "./fast/tools.ts";
import {fastChecks} from "./fast/run.ts";
import {ciPolicy} from "./runtime/ci.ts";
import {mkdtempSync, rmSync} from "node:fs";
import {secretCheck} from "./runtime/secrets.ts";
import {effects} from "./runtime/effects.ts";
import {spawnSync} from 'node:child_process';
import {analyze} from './policy.ts';
import {Snapshot, git} from './snapshot.ts';
import {checkComments} from './comments.ts';
import {checkStaged} from './guards/staged.ts';

let phaseStart = performance.now();
function phase(name: string) { console.error(`Pre-commit ${name}: ${Math.round(performance.now() - phaseStart)}ms`); phaseStart = performance.now(); }
try {
  const cwd = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const tree = git(['write-tree'], cwd).trim(); // fails on an unmerged index
  const ref = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {cwd, encoding: 'utf8'});
  if (ref.error || (ref.status !== 0 && ref.status !== 1)) throw new Error('Cannot read HEAD baseline');
  const head = ref.status === 0 ? ref.stdout.trim() : undefined;
  const secrets = secretCheck(cwd, head, tree);
  if (secrets.length) throw new Error(secrets.join("\n"));
  phase("secrets");
  const scratch = mkdtempSync("/tmp/apparent-dev-hook-index-");
  try {
    const env = {...process.env, GIT_INDEX_FILE: scratch + "/index"};
    const read = spawnSync("git", ["read-tree", tree], {cwd, env});
    if (read.status !== 0) throw new Error("Cannot isolate staged width index");
    const width = spawnSync("python3", [cwd + "/enablement/directory-width/check.py"], {cwd, env, stdio: "inherit"});
    if (width.status !== 0) process.exitCode = 1;
  } finally { rmSync(scratch, {recursive: true, force: true}); }
  if (process.exitCode) process.exit(1);
  phase("width");
  const committed = new Snapshot(cwd, head);
  const staged = new Snapshot(cwd, tree);
  validateTools(staged);
  const oldGlobals: Edge[] = [], newGlobals: Edge[] = [];
  const oldDOM = new Set<string>(), newDOM = new Set<string>();
  const oldEffects = effects(committed, oldDOM, oldGlobals);
  for (const [key, count] of effects(staged, newDOM, newGlobals)) if (count > (oldEffects.get(key) ?? 0)) {
    console.error(key.split(":")[0] + ": new React useEffect source/use; prefer event handlers, derived state or an explicit lifecycle adapter");
    process.exitCode = 1;
  }
  const baseline = analyze(committed, undefined, oldGlobals);
  const candidate = analyze(staged, undefined, newGlobals);
  for (const issue of oldDOM) baseline.add(issue);
  for (const issue of newDOM) candidate.add(issue);
  for (const issue of ciPolicy(committed)) baseline.add(issue);
  for (const issue of ciPolicy(staged)) candidate.add(issue);
  const added = [...candidate].filter(edge => !baseline.has(edge));
  if (added.length) {
    console.error('Dependency policy: new forbidden or unsupported edges in the staged snapshot:\n' + added.sort().map(e => '  ' + e).join('\n'));
    console.error('Use the allowed owner’s public exports, or stage the missing source/config/dependency declaration. Existing committed debt is tolerated.');
    process.exitCode = 1;
  }
  phase("graphs/effects/CI");
  const stagedErrors = await checkStaged(cwd, head, tree, console.warn);
  if (stagedErrors.length) {
    console.error(stagedErrors.join("\n"));
    process.exitCode = 1;
  }
  phase("budgets/style");
  if (!process.exitCode) {
    const errors = await checkComments(cwd, head, tree);
    if (errors.length) {
      console.error('Staged comment policy:\n' + errors.map(e => '  ' + e).join('\n'));
      process.exitCode = 1;
    }
  }
  phase("comments");
  if (!process.exitCode) await fastChecks(cwd, head, tree, staged, committed);
  phase("affected checks");
  if (head && git(["rev-parse", "--verify", "--quiet", "HEAD"], cwd).trim() !== head) throw new Error("HEAD changed during checks; retry the complete snapshot");
  if (git(["write-tree"], cwd).trim() !== tree) throw new Error("Index changed during checks; retry the complete staged snapshot");
} catch (error) {
  console.error('Dependency policy failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
