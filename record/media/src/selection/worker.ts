import {fstatSync, readFileSync} from 'node:fs';
import {speechCues} from './cues.ts';

const MAX_BYTES = 16 * 1024 * 1024;
try {
  const input = fstatSync(0);
  if (process.argv.length !== 2 || !input.isFile() || input.size > MAX_BYTES
    || (input.mode & 0o777) !== 0o600) throw Error('Invalid input');
  const bytes = readFileSync(0);
  if (bytes.length > MAX_BYTES) throw Error('Invalid input');
  const request: unknown = JSON.parse(bytes.toString('utf8'));
  if (!request || typeof request !== 'object' || Array.isArray(request)
    || Object.keys(request).sort().join(',') !== 'estimated,version,words') throw Error('Invalid input');
  const {version, estimated, words} = request as Record<string, unknown>;
  if (version !== 1 || typeof estimated !== 'boolean' || !Array.isArray(words)
    || words.some(word => typeof word !== 'string')) throw Error('Invalid input');
  const output = JSON.stringify({version: 1, cues: speechCues(estimated, words)}) + '\n';
  if (Buffer.byteLength(output) > MAX_BYTES) throw Error('Invalid output');
  process.stdout.write(output);
} catch {
  process.stderr.write('Record could not classify speech cues\n');
  process.exitCode = 1;
}
