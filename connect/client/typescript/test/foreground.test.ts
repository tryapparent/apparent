import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadForeground, type Operation, type Port, type Progress, type Upload } from '../src/foreground.ts';

const id = 'a'.repeat(32);
const hash = 'b'.repeat(64);
const origin = 'https://connect.example.test';
const files = [
  { path: 'bundle/manifest.json', size: 12, sha256: hash },
  { path: 'bundle/frames/0001.jpg', size: 28, sha256: 'c'.repeat(64) },
];
const input = (overrides: Partial<Upload> = {}): Upload => ({
  id, server: origin, format: 'plaintext-v1', files, share: true, ...overrides,
});
const manifest = (source: Upload = input()) => source.files.map(file => ({ ...file }));

function harness(respond: (operation: Operation) => unknown | Promise<unknown>) {
  const operations: Operation[] = [];
  const progress: Progress[] = [];
  const port: Port = {
    async request(operation) {
      operations.push(operation);
      return respond(operation);
    },
    async progress(value) { progress.push(value); },
  };
  return { port, operations, progress };
}

function normalResponse(operation: Operation, source: Upload = input()): unknown {
  switch (operation.operation) {
    case 'reserve': return { id: source.id, status: 'pending', format: source.format };
    case 'put': return { ok: true };
    case 'complete': return { id: source.id, status: 'ready', format: source.format };
    case 'verify': return { id: source.id, status: 'ready', format: source.format, files: manifest(source) };
    case 'share': return { status: 'ready', url: `${source.server}/s/${'d'.repeat(64)}` };
  }
}

test('reserves, uploads each file, completes, reads back the exact manifest, then shares', async () => {
  const source = input();
  const h = harness(operation => normalResponse(operation, source));
  assert.deepEqual(await uploadForeground(source, h.port), { id, url: `${origin}/s/${'d'.repeat(64)}` });
  assert.deepEqual(h.operations, [
    { operation: 'reserve' }, { operation: 'put', index: 0 }, { operation: 'put', index: 1 },
    { operation: 'complete' }, { operation: 'verify' }, { operation: 'share' },
  ]);
  assert.deepEqual(h.progress, [
    { state: 'uploading', uploadedBytes: 0, totalBytes: 40 },
    { state: 'uploading', uploadedBytes: 12, totalBytes: 40 },
    { state: 'uploading', uploadedBytes: 40, totalBytes: 40 },
    { state: 'verifying', uploadedBytes: 40, totalBytes: 40 },
    { state: 'ready', uploadedBytes: 40, totalBytes: 40 },
  ]);
  for (const update of h.progress) {
    assert.ok(update.uploadedBytes >= 0 && update.uploadedBytes <= update.totalBytes);
  }
});

test('pins encrypted format at reserve, completion and readback; encrypted uploads never share', async () => {
  const source = input({ format: 'apparent-encrypted-v1', share: false });
  const h = harness(operation => {
    const response = normalResponse(operation, source) as Record<string, unknown>;
    return operation.operation === 'complete' ? { ...response, format: 'plaintext-v1' } : response;
  });
  await assert.rejects(uploadForeground(source, h.port), /upload_failed/);
  assert.deepEqual(h.operations.map(operation => operation.operation), ['reserve', 'put', 'put', 'complete']);
  assert.ok(!h.operations.some(operation => operation.operation === 'share'));

  for (const operation of ['reserve', 'verify'] as const) {
    const mismatched = harness(op => {
      const response = normalResponse(op, source) as Record<string, unknown>;
      return op.operation === operation ? { ...response, format: 'plaintext-v1' } : response;
    });
    await assert.rejects(uploadForeground(source, mismatched.port), /upload_failed/);
    assert.ok(!mismatched.operations.some(op => op.operation === 'share'));
  }
});

test('ready reservation skips PUT and completion but still verifies before sharing', async () => {
  const source = input();
  const h = harness(operation => operation.operation === 'reserve'
    ? { id, status: 'ready', format: source.format }
    : normalResponse(operation, source));
  assert.deepEqual(await uploadForeground(source, h.port), { id, url: `${origin}/s/${'d'.repeat(64)}` });
  assert.deepEqual(h.operations.map(operation => operation.operation), ['reserve', 'verify', 'share']);

  const badReadback = harness(operation => operation.operation === 'reserve'
    ? { id, status: 'ready', format: source.format }
    : operation.operation === 'verify'
      ? { id, status: 'ready', format: source.format, files: [] }
      : normalResponse(operation, source));
  await assert.rejects(uploadForeground(source, badReadback.port), /upload_failed/);
  assert.deepEqual(badReadback.operations.map(operation => operation.operation), ['reserve', 'verify']);
});

test('ID, status, format, manifest, and share URL mismatches fail closed without retry or fallback', async () => {
  const source = input();
  const cases: Array<{ name: string; alter: (operation: Operation, response: unknown) => unknown; last: string }> = [
    { name: 'reservation ID', alter: (op, response) => op.operation === 'reserve' ? { ...(response as object), id: 'e'.repeat(32) } : response, last: 'reserve' },
    { name: 'reservation status', alter: (op, response) => op.operation === 'reserve' ? { ...(response as object), status: 'failed' } : response, last: 'reserve' },
    { name: 'completion status', alter: (op, response) => op.operation === 'complete' ? { ...(response as object), status: 'pending' } : response, last: 'complete' },
    { name: 'verification ID', alter: (op, response) => op.operation === 'verify' ? { ...(response as object), id: 'e'.repeat(32) } : response, last: 'verify' },
    { name: 'verification manifest size', alter: (op, response) => op.operation === 'verify' ? { ...(response as object), files: [{ ...files[0], size: 999 }, files[1]] } : response, last: 'verify' },
    { name: 'verification manifest digest', alter: (op, response) => op.operation === 'verify' ? { ...(response as object), files: [{ ...files[0], sha256: 'e'.repeat(64) }, files[1]] } : response, last: 'verify' },
    { name: 'verification manifest path', alter: (op, response) => op.operation === 'verify' ? { ...(response as object), files: [{ ...files[0], path: 'other.json' }, files[1]] } : response, last: 'verify' },
    { name: 'share not ready', alter: (op, response) => op.operation === 'share' ? { ...(response as object), status: 'pending' } : response, last: 'share' },
    { name: 'share URL outside server', alter: (op, response) => op.operation === 'share' ? { ...(response as object), url: `https://attacker.example/s/${'d'.repeat(64)}` } : response, last: 'share' },
    { name: 'malformed share URL', alter: (op, response) => op.operation === 'share' ? { ...(response as object), url: `${origin}/s/not-a-hash` } : response, last: 'share' },
  ];
  for (const item of cases) {
    const h = harness(operation => item.alter(operation, normalResponse(operation, source)));
    await assert.rejects(uploadForeground(source, h.port), /upload_failed/, item.name);
    assert.equal(h.operations.at(-1)?.operation, item.last, item.name);
    assert.equal(h.operations.filter(operation => operation.operation === 'reserve').length, 1, item.name);
  }
});

test('transport failures stop immediately; zero-byte files keep bounded zero progress', async () => {
  const source = input({ files: [{ path: 'bundle/empty', size: 0, sha256: hash }], share: false });
  const zero = harness(operation => normalResponse(operation, source));
  assert.deepEqual(await uploadForeground(source, zero.port), { id, url: null });
  assert.deepEqual(zero.progress, [
    { state: 'uploading', uploadedBytes: 0, totalBytes: 0 },
    { state: 'uploading', uploadedBytes: 0, totalBytes: 0 },
    { state: 'verifying', uploadedBytes: 0, totalBytes: 0 },
    { state: 'ready', uploadedBytes: 0, totalBytes: 0 },
  ]);

  for (const failedAt of ['reserve', 'put', 'complete', 'verify'] as const) {
    const h = harness(operation => {
      if (operation.operation === failedAt) throw new Error('synthetic transport failure');
      return normalResponse(operation, source);
    });
    await assert.rejects(uploadForeground(source, h.port));
    assert.equal(h.operations.at(-1)?.operation, failedAt);
    assert.equal(h.operations.filter(operation => operation.operation === failedAt).length, 1);
    assert.ok(!h.operations.some(operation => operation.operation === 'share'));
  }
});
