// into archive-v0. Snapshot only those objects, never sdists/builds, Git trees,
// interpreters, environments or profiles. Run after uv exits, not concurrently.
import {createHash} from 'node:crypto';
import {cp, lstat, mkdir, readdir, readFile, readlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function cacheKey(inputs: Record<string, string | Buffer>): string {
  const hash = createHash('sha256');
  for (const name of Object.keys(inputs).sort()) {
    const value = Buffer.from(inputs[name]);
    hash.update(`${name.length}:${name}:${value.length}:`).update(value);
  }
  return `hermes-validator-downloads-v1-${hash.digest('hex')}`;
}

async function plainTree(root: string): Promise<void> {
  for (const name of await readdir(root)) {
    const file = path.join(root, name);
    const info = await lstat(file);
    if (info.isDirectory()) await plainTree(file);
    else if (!info.isFile()) throw new Error(`Nonregular wheel content: ${file}`);
  }
}

export async function snapshot(cache: string, destination: string): Promise<void> {
  // Destination must be new: never merge an older snapshot or another run's data.
  await mkdir(destination, {mode: 0o700});
  const index = path.join(cache, 'wheels-v7/pypi');
  const archives = new Set<string>();
  async function visit(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name);
      const info = await lstat(file);
      if (info.isDirectory()) { await visit(file); continue; }
      if (info.isSymbolicLink()) {
        const target = path.resolve(path.dirname(file), await readlink(file));
        if (path.dirname(target) !== path.resolve(cache, 'archive-v0') ||
            !(await lstat(target)).isDirectory()) throw new Error(`Invalid wheel archive: ${file}`);
        archives.add(target);
      } else if (!info.isFile()) throw new Error(`Invalid wheel index: ${file}`);
    }
  }
  // Unsupported future uv layouts fail instead of snapshotting an unqualified cache.
  await visit(index);
  for (const archive of archives) {
    await plainTree(archive);
    await cp(archive, path.join(destination, 'archive-v0', path.basename(archive)), {recursive: true});
  }
  await cp(index, path.join(destination, 'wheels-v7/pypi'), {recursive: true, verbatimSymlinks: true});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'snapshot' && args.length === 2) await snapshot(args[0], args[1]);
  else if (mode === 'key' && args.length === 3) {
    const [runtime, workflow, output] = args;
    const identity = process.env.VALIDATOR_IDENTITY;
    if (!identity) throw new Error('Missing validator identity');
    const inputs: Record<string, string | Buffer> = {identity};
    for (const name of ['uv.lock', 'pyproject.toml', 'pm/lock.json']) inputs[name] = await readFile(path.join(runtime, name));
    inputs.workflow = await readFile(workflow);
    inputs.validator = await readFile(new URL('../../enablement/ci/validator.ts', import.meta.url));
    inputs.job = await readFile(new URL('../../enablement/ci/validator-job.ts', import.meta.url));
    inputs.policy = await readFile(new URL('./downloads.ts', import.meta.url));
    await writeFile(output, `key=${cacheKey(inputs)}\n`, {flag: 'a'});
  } else throw new Error('Expected key RUNTIME WORKFLOW OUTPUT or snapshot CACHE DESTINATION');
}
