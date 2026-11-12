// Publication guards consume the shared directory/consumer authority.
// This module supplies Git ancestry/input proof, not another selector.
import {routeDecision} from './consumers.ts';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export {streamPaths, affectsStream} from './consumers.ts';
import {streamPaths} from './consumers.ts';
import type {Stream} from './consumers.ts';
export type {Stream} from './consumers.ts';

// Complete local Git history avoids GitHub compare's 300-file truncation. A
// descendant main is safe only when this stream's complete input tree is equal.
export function currentStream(stream: Stream, candidate: string, main = 'origin/main', cwd = process.cwd()): boolean {
  if (!/^[a-f0-9]{40}$/.test(candidate)) throw Error('Invalid candidate SHA');
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  git('merge-base', '--is-ancestor', candidate, main);
  return !git('diff', '--no-renames', '--name-only', '-z', candidate, main, '--')
    .split('\0').filter(Boolean).some(path => routeDecision([path]).publicationStreams[stream]);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stream, candidate] = process.argv.slice(2);
  if (!Object.hasOwn(streamPaths, stream)) throw Error('Unknown value stream');
  process.exitCode = currentStream(stream as Stream, candidate) ? 0 : 1;
}
