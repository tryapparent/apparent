// Automatic workflow boundaries. Only positive directory prefixes or exact files;
// workflow YAML is checked against this inventory by the routing contracts.
import {documentationOnlyPath} from './consumers.ts';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const common = ['shared/**', 'composition/**', 'enablement/ci/**', '.github/actions/**'];
const native = ['Cargo.toml', 'Cargo.lock', 'build.rs', 'main.rs', '.cargo/**',
  '.github/workflows/verification-platform.yml', 'enablement/verification.py',
  'enablement/prerequisites/**', 'enablement/local-tests/**', 'enablement/native-build/**'];
export const streamPaths = {
  capture: [...common, ...native, 'capture/**', 'record/**', 'connect/client/**', 'connect/hosted.rs', 'connect/mod.rs',
    'enablement/**', '.githooks/**', 'AGENTS.md', '.github/workflows/checks.yml',
    '.github/workflows/verification.yml', '.github/workflows/verification-mac.yml',
    '.github/workflows/release-linux.yml', '.github/workflows/release-mac-preview.yml',
    '.github/workflows/linux-updater-harness.yml',
    // The app embeds this wordmark; the remaining Public tree is independent.
    'public/site/public/assets/brand/apparent-wordmark.svg'],
  connect: [...common, ...native, 'connect/**', 'public/site/**',
    '.github/workflows/stream-connect.yml', 'enablement/release_gate.py'],
  public: [...common, 'public/**', '.github/workflows/stream-public.yml', 'README.md',
    'capture/agent/skills/apparent/SKILL.md', 'capture/agent/docs/usage.md',
    'capture/desktop/docs/guides/recording.md', 'capture/engine/docs/guides/processing.md'],
  hermes: [...common, 'hermes/**', 'capture/agent/setup/**',
    'capture/desktop/ui/frontend/src/hermes/**', '.github/workflows/hermes.yml'],
} as const;
export type Stream = keyof typeof streamPaths;
export function affectsStream(stream: Stream, path: string): boolean {
  return streamPaths[stream].some(pattern => pattern.endsWith('/**')
    ? path.startsWith(pattern.slice(0, -2)) : path === pattern);
}

// Complete local Git history avoids GitHub compare's 300-file truncation. A
// descendant main is safe only when this stream's complete input tree is equal.
export function currentStream(stream: Stream, candidate: string, main = 'origin/main', cwd = process.cwd()): boolean {
  if (!/^[a-f0-9]{40}$/.test(candidate)) throw Error('Invalid candidate SHA');
  const git = (...args: string[]) => execFileSync('git', args, {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  git('merge-base', '--is-ancestor', candidate, main);
  return !git('diff', '--no-renames', '--name-only', '-z', candidate, main, '--')
    .split('\0').filter(Boolean).some(path => affectsStream(stream, path) && !(stream === 'capture' && documentationOnlyPath(path)));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [stream, candidate] = process.argv.slice(2);
  if (!Object.hasOwn(streamPaths, stream)) throw Error('Unknown value stream');
  process.exitCode = currentStream(stream as Stream, candidate) ? 0 : 1;
}
