import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Config, secret } from './config.ts';

const origin = 'https://app.tryapparent.com/connect';
const maxBytes = 24 * 1024 * 1024;
const run = promisify(execFile);

export function supportReportId(context: string): string | undefined {
  const ids = new Set([...context.matchAll(/\bapparent-support-report:([a-f0-9]{32})(?![a-f0-9])/g)].map(match => match[1]));
  if (ids.size > 1) throw Error('Multiple private reports in one issue');
  return ids.values().next().value;
}

function evidencePath(config: Config, issue: string) {
  if (!/^[a-f0-9-]{36}$/.test(issue)) throw Error('Invalid support issue identity');
  return join(config.stateDirectory, 'support-' + issue);
}

export async function fetchSupportReport(config: Config, issue: string, id: string, request = fetch) {
  if (!config.support) throw Error('Private support reader is not configured');
  const { executable, keyFile, tokenFile } = config.support;
  const token = secret(tokenFile);
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid private support token');
  if (!/^[a-f0-9]{32}$/.test(id)) throw Error('Invalid private report identity');
  const directory = evidencePath(config, issue);
  await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error; });
  const root = await lstat(directory);
  if (!root.isDirectory() || (root.mode & 0o077) !== 0 || root.uid !== process.getuid?.()) throw Error('Unsafe private evidence directory');
  const result = join(directory, id + '.apparent');
  const previous = await lstat(result).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (previous) {
    if (!previous.isDirectory() || (previous.mode & 0o077) !== 0 || previous.uid !== process.getuid?.())
      throw Error('Unsafe private evidence directory');
    return result;
  }
  const scratch = await mkdtemp(join(config.stateDirectory, 'support-work-'));
  try {
    const response = await request(`${origin}/v1/support-reports/${id}`, {
      headers: {Authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    const length = Number(response.headers.get('Content-Length'));
    if (!response.ok || !Number.isSafeInteger(length) || length <= 0 || length > maxBytes || !response.body) {
      await response.body?.cancel();
      throw Error('Private recording unavailable');
    }
    const stream = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await stream.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > length) throw Error('Private recording exceeded its bound');
        chunks.push(value);
      }
    } finally { await stream.cancel().catch(() => {}); }
    if (bytes !== length) throw Error('Incomplete private recording');
    const input = join(scratch, 'report.age');
    await writeFile(input, Buffer.concat(chunks), { mode: 0o600, flag: 'wx' });
    await run(executable, ['connect', 'open-support-report', input, result, origin, id, keyFile],
      { timeout: 30000, maxBuffer: 8192 });
    return result;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function removeSupportReport(config: Config, issue: string) {
  if (config.support) await rm(evidencePath(config, issue), { recursive: true, force: true });
}
