import {fstatSync, readFileSync} from 'node:fs';
import {alignTranscript, type TimedText} from './policy.ts';

// Native composition passes a held, finite private file as stdin. Text never
// enters argv, diagnostic output, or a pathname-based request protocol.
const MAX_BYTES = 16 * 1024 * 1024;
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error('Invalid request');
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) throw Error('Invalid request');
  const result = BigInt(value);
  if (result > 0xffff_ffff_ffff_ffffn) throw Error('Invalid request');
  return result;
}
function times(value: unknown): bigint[] {
  if (!Array.isArray(value)) throw Error('Invalid request');
  return value.map(timestamp);
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw Error('Invalid request');
  return value;
}
function units(value: unknown): TimedText[] {
  if (!Array.isArray(value)) throw Error('Invalid request');
  return value.map(item => {
    const unit = object(item, ['t0', 't1', 'text']);
    return {t0: timestamp(unit.t0), t1: timestamp(unit.t1), text: text(unit.text)};
  });
}
try {
  const input = fstatSync(0);
  if (process.argv.length !== 2 || !input.isFile() || input.size > MAX_BYTES) throw Error('Invalid request');
  const bytes = readFileSync(0);
  if (bytes.length > MAX_BYTES) throw Error('Invalid request');
  const request = object(JSON.parse(bytes.toString('utf8')), ['version', 'times', 'anchors', 'transcript']);
  if (request.version !== 1) throw Error('Invalid request');
  const transcript = object(request.transcript, ['text', 'words', 'segments']);
  const said = alignTranscript(times(request.times), times(request.anchors), {
    text: text(transcript.text), words: units(transcript.words), segments: units(transcript.segments),
  });
  const output = JSON.stringify({version: 1, said}) + '\n';
  if (Buffer.byteLength(output) > MAX_BYTES) throw Error('Invalid response');
  process.stdout.write(output);
} catch {
  process.stderr.write('Record could not allocate transcript text\n');
  process.exitCode = 1;
}
