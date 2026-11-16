import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateOutput } from './validate-output.ts'

export const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
async function files(root: string, path = ''): Promise<{ path: string; sha256: string }[]> {
  const result: { path: string; sha256: string }[] = []
  for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
    const name = path ? path + '/' + entry.name : entry.name
    if (name === 'receipt.json') continue
    if (entry.isDirectory()) result.push(...await files(root, name))
    else result.push({ path: name, sha256: digest(await readFile(resolve(root, name))) })
  }
  return result.sort((a, b) => a.path.localeCompare(b.path))
}
export async function verifySeal(root: string, sha: string) {
  assert.match(sha, /^[a-f0-9]{40}$/)
  await validateOutput(root)
  const receipt = JSON.parse(await readFile(resolve(root, 'receipt.json'), 'utf8'))
  assert.equal(receipt.sha, sha, 'Artifact was not built from the admitted commit')
  assert.deepEqual(receipt.files, await files(root), 'Artifact bytes changed after verification')
  return receipt as { sha: string; files: { path: string; sha256: string }[] }
}
export async function seal(root: string, sha: string) {
  assert.match(sha, /^[a-f0-9]{40}$/)
  await validateOutput(root)
  await writeFile(resolve(root, 'receipt.json'), JSON.stringify({ sha, files: await files(root) }) + '\n')
  return verifySeal(root, sha)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '../.output'), sha = process.argv[2]
  await seal(root, sha)
}
