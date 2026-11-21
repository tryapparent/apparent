import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { type Config, secret } from './config.ts';

const origin = 'https://app.tryapparent.com/connect';
const maxBytes = 32 * 1024 * 1024;
const maxArchiveBytes = 34 * 1024 * 1024;
const run = promisify(execFile);

export function supportReportId(context: string): string | undefined {
  const ids = new Set([...context.matchAll(/\bapparent-support-report:([a-f0-9]{32})(?![a-f0-9])/g)].map(match => match[1]));
  if (ids.size > 1) throw Error('Multiple private reports in one issue');
  return ids.values().next().value;
}

export async function fetchSupportArchive(config: Config, id: string, request = fetch) {
  if (!config.support) throw Error('Private support reader is not configured');
  const { executable, keyFile, tokenFile } = config.support;
  const token = secret(tokenFile);
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid private support token');
  if (!/^[a-f0-9]{32}$/.test(id)) throw Error('Invalid private report identity');
  const scratch = await mkdtemp(join(await realpath(tmpdir()), 'apparent-support-'));
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
    const output = join(scratch, 'recording.apparent');
    await writeFile(input, Buffer.concat(chunks), { mode: 0o600, flag: 'wx' });
    await run(executable, ['connect', 'open-support-report', input, output, origin, id, keyFile],
      { timeout: 30000, maxBuffer: 8192 });
    const {stdout} = await run('/usr/bin/tar', ['--format=ustar', '-cf', '-', '-C', scratch, 'recording.apparent'],
      { encoding: 'buffer', timeout: 5000, maxBuffer: maxArchiveBytes });
    return stdout;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
