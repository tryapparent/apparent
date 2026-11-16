import assert from 'node:assert/strict'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { seal, verifySeal } from '../scripts/seal.ts'

test('the producer artifact rejects another admitted SHA and any changed deployment bytes', async () => {
  const job = await mkdtemp(resolve(tmpdir(), 'connect-seal-')), root = resolve(job, 'artifact'), sha = 'a'.repeat(40)
  try {
    await cp(resolve(import.meta.dirname, '../.output'), root, { recursive: true })
    const receipt = await seal(root, sha)
    assert.ok(receipt.files.some(file => file.path === 'worker.js'))
    assert.ok(receipt.files.some(file => file.path === 'dist/connect/index.html'))
    await assert.rejects(verifySeal(root, 'b'.repeat(40)), /admitted commit/)
    await writeFile(resolve(root, 'worker.js'), 'unverified successor')
    await assert.rejects(verifySeal(root, sha), /bytes changed/)
  } finally { await rm(job, { recursive: true, force: true }) }
})
