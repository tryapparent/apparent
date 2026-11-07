import { createHash } from 'node:crypto'
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export type Target = 'linux-x64' | 'macos-x64'
export type InventoryEntry =
  | { path: string; kind: 'directory'; mode: number }
  | { path: string; kind: 'file'; mode: number; sha256: string }
  | { path: string; kind: 'symlink'; mode: number; target: string }

export interface DeliveryManifest {
  schema: 1
  id: 'platform-native-host'
  source: { commit: string; tree: string }
  target: Target
  profile: 'development-app'
  buildProfile: 'debug'
  entry: string
  launch: 'execute-appimage' | 'launch-services-open'
  argv: ['--appimage-extract-and-run', 'app'] | ['app']
  nativeHostProtocol: 1
  guiExecutable: { container: 'appimage' | 'artifact'; path: string; mode: number; sha256: string }
  buildEnvironment: { os: 'linux' | 'darwin'; arch: 'x64'; cargo: string; rustc: string; packagingToolsSha256: string | null }
  packagingInput: null | { path: 'target/debug/apparent'; mode: number; sha256: string }
  processProfile: {
    home: 'trusted-launch-home'
    config: 'APPARENT_CONFIG-or-HOME/.config/apparent/config.json'
    socket: 'HOME/.config/apparent/agent-control/capture.sock'
  }
  inventory: InventoryEntry[]
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const normalizedRelative = (path: string) => !isAbsolute(path) &&
  !path.split(/[\\/]/).some((part) => part === '..' || part === '.' || part === '') &&
  !path.includes('\\') && !/[\0\r\n]/.test(path) && !/^[A-Za-z]:/.test(path)

export async function readProducerFile(path: string, maximumBytes = 1024 * 1024 * 1024) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximumBytes) || (Number(before.mode) & 0o7000)) {
      throw new Error('artifact data must be bounded, single-link regular files without special modes')
    }
    const bytes = await handle.readFile()
    const after = await handle.stat({ bigint: true })
    const named = await lstat(path, { bigint: true })
    for (const stat of [after, named]) {
      if (!stat.isFile() || ['dev', 'ino', 'nlink', 'size', 'mode', 'mtimeNs', 'ctimeNs'].some(
        key => stat[key as keyof typeof stat] !== before[key as keyof typeof before])) {
        throw new Error('artifact changed while being inspected')
      }
    }
    if (BigInt(bytes.length) !== before.size) throw new Error('artifact changed while being read')
    return { bytes, mode: Number(before.mode) & 0o777 }
  } finally { await handle.close() }
}

export function selectTarget(envTarget: string | undefined, platform: string, arch: string): Target {
  const host = platform === 'linux' && arch === 'x64' ? 'linux-x64'
    : platform === 'darwin' && arch === 'x64' ? 'macos-x64' : undefined
  if (!host) throw new Error(`unsupported native build host: ${platform}-${arch}`)
  if (envTarget !== undefined && envTarget !== host) {
    throw new Error(`cross-target build refused: requested ${envTarget}, host is ${host}`)
  }
  return host
}

export async function inventoryTree(root: string, prefix = ''): Promise<InventoryEntry[]> {
  const result: InventoryEntry[] = []
  for (const name of (await readdir(resolve(root, prefix))).sort()) {
    // The required top-level manifest is checked separately; it cannot hash itself.
    if (!prefix && name === 'manifest.json') continue
    const path = prefix ? `${prefix}/${name}` : name
    if (!normalizedRelative(path)) throw new Error(`unsafe inventory path: ${path}`)
    const absolute = resolve(root, path)
    const info = await lstat(absolute)
    const mode = info.mode & 0o777
    if (info.isSymbolicLink()) {
      const target = await readlink(absolute)
      result.push({ path, kind: 'symlink', mode, target })
      continue
    }
    if (info.isDirectory()) {
      result.push({ path, kind: 'directory', mode })
      result.push(...await inventoryTree(root, path))
    } else if (info.isFile()) {
      const file = await readProducerFile(absolute)
      result.push({ path, kind: 'file', mode: file.mode, sha256: digest(file.bytes) })
    } else {
      throw new Error(`unsupported artifact entry: ${path}`)
    }
  }
  return result
}

function safeLinkTarget(path: string, target: string): boolean {
  if (!path.startsWith('Apparent.app/') || !target || isAbsolute(target) || target.includes('\\') || /[\0\r\n]/.test(target)) return false
  const resolved = resolve('/', 'bundle', path, '..', target)
  return resolved === '/bundle/Apparent.app' || resolved.startsWith('/bundle/Apparent.app/')
}

export async function validateArtifact(root: string, manifest: DeliveryManifest): Promise<void> {
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('artifact root must be a real directory')
  if (manifest.schema !== 1 || manifest.id !== 'platform-native-host') throw new Error('unsupported delivery manifest')
  const expectedTarget = manifest.target === 'linux-x64' ? 'execute-appimage'
    : manifest.target === 'macos-x64' ? 'launch-services-open' : undefined
  if (!expectedTarget || manifest.launch !== expectedTarget) throw new Error('target launch mechanism mismatch')
  if (manifest.nativeHostProtocol !== 1 || !isDeepStrictEqual(manifest.argv,
    manifest.target === 'linux-x64' ? ['--appimage-extract-and-run', 'app'] : ['app'])) {
    throw new Error('unsupported native host launch protocol or arguments')
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.source?.commit) || !/^[a-f0-9]{40}$/.test(manifest.source?.tree)
      || manifest.profile !== 'development-app' || manifest.buildProfile !== 'debug'
      || !isDeepStrictEqual(manifest.processProfile, { home: 'trusted-launch-home',
        config: 'APPARENT_CONFIG-or-HOME/.config/apparent/config.json', socket: 'HOME/.config/apparent/agent-control/capture.sock' })) {
    throw new Error('unsupported source, profile or native endpoint identity')
  }
  if (manifest.buildEnvironment.arch !== 'x64' ||
      (manifest.target === 'linux-x64' && (manifest.buildEnvironment.os !== 'linux' ||
        !/^[a-f0-9]{64}$/.test(manifest.buildEnvironment.packagingToolsSha256 ?? '') ||
        !manifest.packagingInput || manifest.packagingInput.path !== 'target/debug/apparent' ||
        !/^[a-f0-9]{64}$/.test(manifest.packagingInput.sha256) || manifest.packagingInput.mode < 0 || manifest.packagingInput.mode > 0o777)) ||
      (manifest.target === 'macos-x64' && (manifest.buildEnvironment.os !== 'darwin' || manifest.buildEnvironment.packagingToolsSha256 !== null || manifest.packagingInput !== null))) {
    throw new Error('build environment or packaging input does not match target')
  }
  if (!normalizedRelative(manifest.entry) || manifest.entry.startsWith('.')) {
    throw new Error('unsafe artifact entry path')
  }
  const expected = new Map<string, InventoryEntry>()
  for (const entry of manifest.inventory) {
    if (!normalizedRelative(entry.path) || expected.has(entry.path)) throw new Error(`invalid/duplicate inventory path: ${entry.path}`)
    if (entry.kind === 'file' && (!/^[a-f0-9]{64}$/.test(entry.sha256) || entry.mode < 0 || entry.mode > 0o777)) {
      throw new Error(`invalid file metadata: ${entry.path}`)
    }
    if (entry.kind === 'directory' && (entry.mode < 0 || entry.mode > 0o777)) throw new Error(`invalid directory metadata: ${entry.path}`)
    if (entry.kind === 'symlink' && (!safeLinkTarget(entry.path, entry.target) || entry.mode < 0 || entry.mode > 0o777)) {
      throw new Error(`unsafe symlink: ${entry.path}`)
    }
    expected.set(entry.path, entry)
  }
  const actualEntries = await inventoryTree(root)
  if (actualEntries.length !== expected.size) throw new Error('artifact inventory is not closed')
  for (const actual of actualEntries) {
    const wanted = expected.get(actual.path)
    if (!wanted || wanted.kind !== actual.kind || wanted.mode !== actual.mode) throw new Error(`inventory mismatch: ${actual.path}`)
    if (wanted.kind === 'file' && actual.kind === 'file' && wanted.sha256 !== actual.sha256) {
      throw new Error(`artifact hash mismatch: ${actual.path}`)
    }
    if (wanted.kind === 'directory' && actual.kind === 'directory' && wanted.mode !== actual.mode) {
      throw new Error(`artifact directory mode mismatch: ${actual.path}`)
    }
    if (wanted.kind === 'symlink' && actual.kind === 'symlink' && wanted.target !== actual.target) {
      throw new Error(`artifact symlink mismatch: ${actual.path}`)
    }
  }
  const entry = expected.get(manifest.entry)
  if (!entry || entry.kind !== 'file' || (entry.mode & 0o111) === 0) throw new Error('launch entry is missing or not executable')
  if (manifest.target === 'linux-x64') {
    if (manifest.entry !== 'Apparent-x86_64.AppImage' || actualEntries.length !== 1 || entry.mode !== 0o755) {
      throw new Error('unsupported Linux GUI inventory')
    }
    if (manifest.guiExecutable?.container !== 'appimage' || manifest.guiExecutable.path !== 'usr/bin/apparent'
        || !/^[a-f0-9]{64}$/.test(manifest.guiExecutable.sha256)
        || !Number.isInteger(manifest.guiExecutable.mode) || manifest.guiExecutable.mode < 0
        || manifest.guiExecutable.mode > 0o777 || !(manifest.guiExecutable.mode & 0o111)) {
      throw new Error('missing packaged AppImage GUI identity')
    }
  } else if (manifest.entry !== 'Apparent.app/Contents/MacOS/apparent'
      || expected.get('Apparent.app')?.kind !== 'directory'
      || actualEntries.some(item => item.path !== 'Apparent.app' && !item.path.startsWith('Apparent.app/'))) {
    throw new Error('unsupported Mac GUI inventory')
  } else if (!isDeepStrictEqual(manifest.guiExecutable, { container: 'artifact',
    path: manifest.entry, mode: entry.mode, sha256: entry.sha256 })) {
    throw new Error('packaged Mac GUI identity does not match inventory')
  }
  for (const item of manifest.inventory) {
    if (item.kind !== 'symlink') continue
    const resolvedPath = resolve(root, item.path, '..', item.target)
    const realRoot = await realpath(resolve(root, 'Apparent.app'))
    const resolvedReal = await realpath(resolvedPath)
    const rel = relative(realRoot, resolvedReal)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`symlink escapes artifact: ${item.path}`)
  }
  const header = await readProducerFile(resolve(root, 'manifest.json'), 4 * 1024 * 1024)
  const stored = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(header.bytes))
  if (!isDeepStrictEqual(stored, manifest)) throw new Error('staged manifest does not match expected identity')
}
