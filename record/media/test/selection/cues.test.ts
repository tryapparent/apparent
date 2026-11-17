import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, closeSync, mkdtempSync, openSync, readFileSync, rmSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {speechCues} from '../../src/selection/cues.ts';

test('pointing words retain their priorities and original indices across punctuation', () => {
  const words = Object.freeze(['unrelated', '“NOW!”', 'here', 'Look.', 'watch', 'see', 'there',
    'THIS', 'these', 'that?', 'those', 'nowhere', 'look-alike', 'look at this']);
  assert.deepEqual(speechCues(false, words), [
    {index: 1, cue: 'now', score: 58, strong: true}, {index: 2, cue: 'here', score: 56, strong: true},
    {index: 3, cue: 'look', score: 58, strong: true}, {index: 4, cue: 'watch', score: 58, strong: true},
    {index: 5, cue: 'see', score: 44, strong: false}, {index: 6, cue: 'there', score: 44, strong: false},
    {index: 7, cue: 'this', score: 44, strong: false}, {index: 8, cue: 'these', score: 44, strong: false},
    {index: 9, cue: 'that', score: 42, strong: false}, {index: 10, cue: 'those', score: 42, strong: false},
  ]);
  assert.deepEqual(speechCues(true, words), [], 'estimated timestamps must never create speech candidates');
});

test('Unicode letters and numbers prevent trimming into a different cue', () => {
  assert.deepEqual(speechCues(false, ['', '👀Look!', '\u0085here\u0085', 'look\u0345', '①look', 'looké',
    'look\u200dhere', '\u0301LOOK\u0301', 'ʰlook']), [
    {index: 1, cue: 'look', score: 58, strong: true}, {index: 2, cue: 'here', score: 56, strong: true},
    {index: 7, cue: 'look', score: 58, strong: true},
  ]);
});

test('real worker uses private held input and rejects malformed or unbounded requests without disclosure', () => {
  const root = mkdtempSync(join(tmpdir(), 'apparent-dev-cues-'));
  const path = join(root, 'input'), worker = fileURLToPath(new URL('../../src/selection/worker.ts', import.meta.url));
  const request = {version: 1, estimated: false, words: ['PRIVATE SENTINEL', 'Look!']};
  const run = (value: unknown, ...args: string[]) => {
    writeFileSync(path, JSON.stringify(value), {mode: 0o600}); chmodSync(path, 0o600);
    const fd = openSync(path, 'r');
    try { return spawnSync(process.execPath, ['--experimental-strip-types', worker, ...args],
      {stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000}); }
    finally { closeSync(fd); }
  };
  const rejected = (result: ReturnType<typeof run>) => {
    assert.equal(result.status, 1); assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'Record could not classify speech cues\n');
  };
  try {
    const ok = run(request); assert.equal(ok.status, 0); assert.equal(ok.stderr, '');
    assert.deepEqual(JSON.parse(ok.stdout), {version: 1, cues: [{index: 1, cue: 'look', score: 58, strong: true}]});
    assert.deepEqual(JSON.parse(run({...request, estimated: true}).stdout), {version: 1, cues: []});
    for (const invalid of [null, 'PRIVATE SENTINEL', {...request, version: 2}, {...request, estimated: 0},
      {...request, words: [3]}, {...request, words: {}}, {...request, extra: 'PRIVATE SENTINEL'}]) rejected(run(invalid));
    rejected(run(request, 'PRIVATE SENTINEL'));
    run(request); const before = readFileSync(path);
    const invoke = () => {
      const fd = openSync(path, 'r');
      try { return spawnSync(process.execPath, ['--experimental-strip-types', worker],
        {stdio: [fd, 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000}); }
      finally { closeSync(fd); }
    };
    chmodSync(path, 0o644); rejected(invoke()); assert.deepEqual(readFileSync(path), before);
    chmodSync(path, 0o600); truncateSync(path, 16 * 1024 * 1024 + 1); rejected(invoke());
    rejected(spawnSync(process.execPath, ['--experimental-strip-types', worker],
      {input: JSON.stringify(request), encoding: 'utf8', timeout: 5000}));
  } finally { rmSync(root, {recursive: true, force: true}); }
});
