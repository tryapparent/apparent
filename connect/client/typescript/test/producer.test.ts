import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {decodeArchive, decryptAge, joinAgeParts, verifyEnvelope} from '../src/index.ts';

test('the TypeScript consumer reads actual native producer bytes, not its own encoder output', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/rust-v1.json', import.meta.url), 'utf8'));
  const bytes = (path: string) => Buffer.from(fixture.transport.find((file: {path:string}) => file.path === path).hex, 'hex');
  const envelope = JSON.parse(bytes('envelope.json').toString('utf8'));
  assert.deepEqual(envelope.signed.context, fixture.context);
  assert.equal(await verifyEnvelope(Buffer.from(fixture.sender.key.signing, 'hex'), envelope.signed, envelope.signature), true);
  const parts = envelope.signed.chunks.map((chunk: {path:string;size:number;sha256:string}) => {
    const part = bytes(chunk.path);
    assert.equal(part.length, chunk.size);
    assert.equal(createHash('sha256').update(part).digest('hex'), chunk.sha256);
    return part;
  });
  const ciphertext = joinAgeParts(parts);
  const archive = decodeArchive(await decryptAge(ciphertext, fixture.syntheticReaderIdentity.age));
  assert.deepEqual(archive.inner.context, fixture.context);
  assert.equal(archive.inner.files.length, fixture.expected.length);
  for (const [index, file] of archive.inner.files.entries()) {
    assert.equal(Buffer.from(archive.fileBytes[index]!).toString('hex'), fixture.expected.find((e: {path:string}) => e.path===file.path).hex);
    assert.equal(createHash('sha256').update(archive.fileBytes[index]!).digest('hex'), file.sha256);
  }
  const truncated = ciphertext.subarray(0, ciphertext.length-1);
  await assert.rejects(decryptAge(truncated, fixture.syntheticReaderIdentity.age));
  const corrupt = ciphertext.slice(); corrupt[corrupt.length-1]! ^= 1;
  await assert.rejects(decryptAge(corrupt, fixture.syntheticReaderIdentity.age));
});
