// Publication guards consume the shared directory/consumer authority.
// This module supplies Git ancestry/input proof, not another selector.
import {selectRange} from '../select.ts';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export {streamPaths, affectsStream} from './consumers.ts';
import {streamPaths, affectsStream} from './consumers.ts';
import type {Stream} from './consumers.ts';
export type {Stream} from './consumers.ts';

// Complete local Git history avoids GitHub compare's 300-file truncation. A
// descendant main is safe when its complete delta has no product inputs. Apply
// the same candidate-blob fixture qualification as local/CI selection, so an
// unrelated tooling push cannot cancel delivery without scheduling a replacement.
export function currentStream(stream: Stream, candidate: string, main = 'origin/main', cwd = process.cwd()): boolean {
  if (!/^[a-f0-9]{40}$/.test(candidate)) throw Error('Invalid candidate SHA');
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  git('merge-base', '--is-ancestor', candidate, main);
  const paths = git('diff', '--no-renames', '--name-only', '-z', candidate, main, '--').split('\0').filter(Boolean);
  if (stream === 'engine') return !paths.some(path => affectsStream(stream, path));
  if (!paths.length) return true;
  const decision = selectRange(candidate, main, cwd, true);
  return !decision.publicationStreams[stream];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stream, candidate] = process.argv.slice(2);
  if (!Object.hasOwn(streamPaths, stream)) throw Error('Unknown value stream');
  process.exitCode = currentStream(stream as Stream, candidate) ? 0 : 1;
}
