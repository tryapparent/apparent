import {fstatSync, readFileSync} from 'node:fs';
import {transcriptRequest} from './request.ts';

// Native composition passes a held, finite private file as stdin. Text never
// enters argv, diagnostic output, or a pathname-based request protocol.
const MAX_BYTES = 16 * 1024 * 1024;
try {
  const input = fstatSync(0);
  if (process.argv.length !== 2 || !input.isFile() || input.size > MAX_BYTES) throw Error('Invalid request');
  const bytes = readFileSync(0);
  if (bytes.length > MAX_BYTES) throw Error('Invalid request');
  const output = transcriptRequest(bytes.toString('utf8')) + '\n';
  if (Buffer.byteLength(output) > MAX_BYTES) throw Error('Invalid response');
  process.stdout.write(output);
} catch {
  process.stderr.write('Record could not allocate transcript text\n');
  process.exitCode = 1;
}
