import {fstatSync, readFileSync} from 'node:fs';
import {speechCueRequest} from './cues-request.ts';

const MAX_BYTES = 16 * 1024 * 1024;
try {
  const input = fstatSync(0);
  if (process.argv.length !== 2 || !input.isFile() || input.size > MAX_BYTES
    || (input.mode & 0o777) !== 0o600) throw Error('Invalid input');
  const bytes = readFileSync(0);
  if (bytes.length > MAX_BYTES) throw Error('Invalid input');
  const output = speechCueRequest(bytes.toString('utf8')) + '\n';
  if (Buffer.byteLength(output) > MAX_BYTES) throw Error('Invalid output');
  process.stdout.write(output);
} catch {
  process.stderr.write('Record could not classify speech cues\n');
  process.exitCode = 1;
}
