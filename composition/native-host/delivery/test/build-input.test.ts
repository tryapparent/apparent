import assert from 'node:assert/strict'
import { chmod, link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { checkNativeExecutable, compiledGuiPath, compiledHelperPath, preparedLinuxTools } from '../src/build-input.ts'
import { inventoryTree, readCargoBuildFile, readProducerFile } from '../src/contract.ts'

test('Cargo hard-linked outputs can be snapshotted without admitting hard-linked artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gui-cargo-hardlink-'))
  try {
    const binary = join(root, 'apparent'), alias = join(root, 'cargo-deps-apparent')
    const bytes = Buffer.from('compiler output')
    await writeFile(binary, bytes, { mode: 0o755 })
    await link(binary, alias)
    assert.deepEqual(await readCargoBuildFile(binary), { bytes, mode: 0o755 })
    await assert.rejects(readProducerFile(binary), /single link/)
    await assert.rejects(inventoryTree(root), /single link/)
    await symlink(binary, join(root, 'symlink'))
    await assert.rejects(readCargoBuildFile(join(root, 'symlink')))
    await chmod(binary, 0o4755)
    await assert.rejects(readCargoBuildFile(binary), /special modes/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('packaging selects the actual Cargo executable and refuses stale fixed output', () => {
  const artifact = (executable: string) => JSON.stringify({ reason: 'compiler-artifact',
    target: { name: 'apparent', kind: ['bin'] }, executable })
  assert.equal(compiledGuiPath('/source', artifact('/source/target/debug/apparent')), '/source/target/debug/apparent')
  for (const transcript of [artifact('/source/target/aarch64-unknown-linux-gnu/debug/apparent'),
    artifact('/different/cache/apparent'), '', artifact('/source/target/debug/apparent') + '\n' + artifact('/source/target/debug/apparent')]) {
    assert.throws(() => compiledGuiPath('/source', transcript), /current Cargo artifact/)
  }
})

test('native executable headers cannot relabel a foreign architecture', () => {
  const elf = Buffer.alloc(32)
  elf.writeUInt32LE(0x464c457f, 0); elf[4] = 2; elf[5] = 1; elf.writeUInt16LE(62, 18)
  checkNativeExecutable(elf, 'linux-x64')
  assert.throws(() => checkNativeExecutable(elf, 'macos-x64'), /format\/architecture/)
  elf.writeUInt16LE(183, 18)
  assert.throws(() => checkNativeExecutable(elf, 'linux-x64'), /format\/architecture/)
  const macho = Buffer.alloc(32)
  macho.writeUInt32LE(0xfeedfacf, 0); macho.writeUInt32LE(0x01000007, 4)
  checkNativeExecutable(macho, 'macos-x64')
  macho.writeUInt32LE(0x0100000c, 4)
  assert.throws(() => checkNativeExecutable(macho, 'macos-x64'), /format\/architecture/)
})

test('packaging consumes the manifest resolved before fingerprinting without querying upstream again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gui-packaging-input-'))
  try {
    const path = join(root, 'tools.json'), bytes = Buffer.from('{"schema":1}\n')
    await writeFile(path, bytes)
    const env = { APPARENT_PACKAGING_TOOLS_MANIFEST: path,
      APPARENT_PACKAGING_TOOLS_SHA256: createHash('sha256').update(bytes).digest('hex') }
    assert.deepEqual((await preparedLinuxTools(env)).bytes, bytes)
    await writeFile(path, '{}')
    await assert.rejects(preparedLinuxTools(env), /changed since/)
    await assert.rejects(preparedLinuxTools({}), /before delivery fingerprinting/)
    await symlink(path, join(root, 'alias'))
    await assert.rejects(preparedLinuxTools({ ...env, APPARENT_PACKAGING_TOOLS_MANIFEST: join(root, 'alias') }))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Mac helper is selected from the same package build-script output, including cached builds', () => {
  const artifact = { reason: 'compiler-artifact', package_id: 'root-apparent',
    target: { name: 'apparent', kind: ['bin'] }, fresh: true }
  const script = { reason: 'build-script-executed', package_id: 'root-apparent',
    out_dir: '/source/target/debug/build/apparent-abc/out' }
  const transcript = (...messages: unknown[]) => messages.map(message => JSON.stringify(message)).join('\n')
  assert.equal(compiledHelperPath('/source', transcript(artifact, script)), script.out_dir + '/apparent-helper')
  for (const messages of [[artifact], [artifact, { ...script, package_id: 'other' }],
    [artifact, { ...script, out_dir: '/foreign/out' }], [artifact, script, script]]) {
    assert.throws(() => compiledHelperPath('/source', transcript(...messages)), /current root Cargo/)
  }
})
