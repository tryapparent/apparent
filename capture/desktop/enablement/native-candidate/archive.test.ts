import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReadStream, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {download, unpack} from './archive.ts';
import {inspectRetainedArchive} from '../../scripts/packaging/native-candidate.ts';
test('download enforces authenticated byte count/digest and exclusive destination', async t => {
  const root = mkdtempSync(join(tmpdir(), 'apparent-dev-candidate-download-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const expected = {sha256: createHash('sha256').update('candidate').digest('hex'), bytes: 9};
  await download(new Response('candidate'), join(root, 'good'), expected);
  await assert.rejects(download(new Response('candidate'), join(root, 'good'), expected));
  for (const [name, body] of [['long','candidate!'],['short','candidate'.slice(1)],['modified','Candidate']])
    await assert.rejects(download(new Response(body), join(root, name), expected));
});
const retained = process.env.APPARENT_RETAINED_PRODUCER_ZIP ? test : test.skip;
retained('actual GitHub-produced archive crosses the new download/unpack and existing inspection boundary', async t => {
  const root = mkdtempSync(join(tmpdir(), 'apparent-dev-candidate-producer-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const metadata = JSON.parse(readFileSync(new URL('producer-artifact.json', import.meta.url), 'utf8'));
  const outer = join(root, 'artifact.zip');
  await download(new Response(Readable.toWeb(createReadStream(process.env.APPARENT_RETAINED_PRODUCER_ZIP!)) as any), outer,
    {sha256: metadata.digest.slice(7), bytes: metadata.size_in_bytes});
  const {archive, manifestPath, manifest} = unpack(outer, root);
  assert.deepEqual(manifest.source, {commit: '77a709910ba6a09e409bce0a50f7afe904a9d677', tree: '697b6d5c2582b02f862cfcfec322f6d2d6b9f205'});
  assert.deepEqual(manifest.run, {id: '43920614168', attempt: '1'});
  await inspectRetainedArchive({archive, manifestPath, expectedSource: manifest.source.commit, expectedArchiveSha256: manifest.artifact.sha256});
  assert.equal(Object.keys(manifest.contents).length, 631);
  // This historical archive remains pending native proof and cannot pass the new producer gate.
  assert.equal(manifest.nativeAcceptance, 'pending'); assert.equal(manifest.releaseAdmission, false);
});
