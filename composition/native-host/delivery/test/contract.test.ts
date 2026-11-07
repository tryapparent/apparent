import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { inventoryTree, selectTarget, validateArtifact, type DeliveryManifest } from '../src/contract.ts'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'native-host-delivery-test-'))
  await mkdir(join(root, 'Apparent.app', 'Contents', 'MacOS'), { recursive: true })
  await writeFile(join(root, 'Apparent.app', 'Contents', 'MacOS', 'apparent'), 'gui')
  await chmod(join(root, 'Apparent.app', 'Contents', 'MacOS', 'apparent'), 0o755)
  const manifest: DeliveryManifest = {
    schema: 1,
    id: 'platform-native-host',
    source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
    target: 'macos-x64',
    profile: 'development-app',
    buildProfile: 'debug',
    entry: 'Apparent.app/Contents/MacOS/apparent',
    launch: 'launch-services-open',
    argv: ['app'],
    nativeHostProtocol: 1,
    guiExecutable: { container: 'artifact', path: 'Apparent.app/Contents/MacOS/apparent', mode: 0o755, sha256: sha('gui') },
    buildEnvironment: { os: 'darwin', arch: 'x64', cargo: 'cargo 1.90.0', rustc: 'rustc 1.90.0', packagingToolsSha256: null },
    packagingInput: null,
    processProfile: { home: 'trusted-launch-home', config: 'APPARENT_CONFIG-or-HOME/.config/apparent/config.json', socket: 'HOME/.config/apparent/agent-control/capture.sock' },
    inventory: await inventoryTree(root),
  }
  await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
  return { root, manifest }
}

test('target selection rejects cross-target and unsupported host builds', () => {
  assert.equal(selectTarget(undefined, 'linux', 'x64'), 'linux-x64')
  assert.throws(() => selectTarget('macos-x64', 'linux', 'x64'), /cross-target/)
  assert.throws(() => selectTarget(undefined, 'linux', 'arm64'), /unsupported native build host/)
})

test('the actual staged artifact includes its manifest without self-hashing', async () => {
  const { root, manifest } = await fixture()
  try {
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 })
    await validateArtifact(root, manifest)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('closed inventory validates exact file hashes, modes, and contained relative links', async () => {
  const { root, manifest } = await fixture()
  try {
    await symlink('MacOS/apparent', join(root, 'Apparent.app', 'Contents', 'current'))
    manifest.inventory = await inventoryTree(root)
    await writeFile(join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    await validateArtifact(root, manifest)
    await writeFile(join(root, 'extra'), 'unexpected')
    await assert.rejects(validateArtifact(root, manifest), /not closed/)
    await rm(join(root, 'extra'))
    await writeFile(join(root, 'Apparent.app/Contents/MacOS/apparent'), 'tampered')
    await assert.rejects(validateArtifact(root, manifest), /hash mismatch/)
    await writeFile(join(root, 'Apparent.app/Contents/MacOS/apparent'), 'gui')
    await chmod(join(root, 'Apparent.app/Contents/MacOS/apparent'), 0o700)
    await assert.rejects(validateArtifact(root, manifest), /inventory mismatch/)
    await chmod(join(root, 'Apparent.app/Contents/MacOS/apparent'), 0o755)
    await symlink('MacOS/../Contents/MacOS/apparent', join(root, 'Apparent.app', 'Contents', 'current-next'))
    await assert.rejects(validateArtifact(root, manifest), /not closed/)
    await rm(join(root, 'Apparent.app', 'Contents', 'current-next'))
    await rm(join(root, 'Apparent.app', 'Contents', 'current'))
    await symlink('MacOS/./apparent', join(root, 'Apparent.app', 'Contents', 'current'))
    await assert.rejects(validateArtifact(root, manifest), /symlink mismatch/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('manifest identity is required and cannot select a different launch profile', async () => {
  const { root, manifest } = await fixture()
  try {
    await rm(join(root, 'manifest.json'))
    await assert.rejects(validateArtifact(root, manifest), /ENOENT/)
    await writeFile(join(root, 'manifest.json'), '{}')
    await assert.rejects(validateArtifact(root, manifest), /manifest does not match/)
    await assert.rejects(validateArtifact(root, { ...manifest, profile: 'release' as never }), /unsupported source, profile/)
    await assert.rejects(validateArtifact(root, { ...manifest, argv: [] as never }), /launch protocol or arguments/)
    await assert.rejects(validateArtifact(root, { ...manifest, processProfile: { ...manifest.processProfile, socket: 'other.sock' as never } }), /unsupported source, profile/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('validator rejects escaping paths, links, and target/launch mismatches', async () => {
  const { root, manifest } = await fixture()
  try {
    manifest.inventory[0] = { path: '../escape', kind: 'file', mode: 0o755, sha256: sha('x') }
    await assert.rejects(validateArtifact(root, manifest), /invalid\/duplicate inventory path/)
    manifest.inventory = await inventoryTree(root)
    manifest.inventory.push({ path: 'bad-link', kind: 'symlink', mode: 0o777, target: '../../../../outside' })
    await assert.rejects(validateArtifact(root, manifest), /unsafe symlink/)
    manifest.inventory = await inventoryTree(root)
    manifest.launch = 'execute-appimage'
    await assert.rejects(validateArtifact(root, manifest), /launch mechanism mismatch/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
