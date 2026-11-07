import { createHash } from 'node:crypto'
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises'
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
  buildEnvironment: { os: 'linux' | 'darwin'; arch: 'x64'; cargo: string; rustc: string }
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
  !path.includes('\\')

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
      result.push({ path, kind: 'file', mode, sha256: digest(await readFile(absolute)) })
    } else {
      throw new Error(`unsupported artifact entry: ${path}`)
    }
  }
  return result
}

function safeLinkTarget(path: string, target: string): boolean {
  if (!target || isAbsolute(target) || target.includes('\\')) return false
  const resolved = resolve('/', 'bundle', path, '..', target)
  return resolved === '/bundle' || resolved.startsWith('/bundle/')
}

export async function validateArtifact(root: string, manifest: DeliveryManifest): Promise<void> {
  if (manifest.schema !== 1 || manifest.id !== 'platform-native-host') throw new Error('unsupported delivery manifest')
  const expectedTarget = manifest.target === 'linux-x64' ? 'execute-appimage'
    : manifest.target === 'macos-x64' ? 'launch-services-open' : undefined
  if (!expectedTarget || manifest.launch !== expectedTarget) throw new Error('target launch mechanism mismatch')
  if (manifest.buildEnvironment.arch !== 'x64' ||
      (manifest.target === 'linux-x64' && (manifest.buildEnvironment.os !== 'linux' ||
        !manifest.packagingInput || manifest.packagingInput.path !== 'target/debug/apparent' ||
        !/^[a-f0-9]{64}$/.test(manifest.packagingInput.sha256) || manifest.packagingInput.mode < 0 || manifest.packagingInput.mode > 0o777)) ||
      (manifest.target === 'macos-x64' && (manifest.buildEnvironment.os !== 'darwin' || manifest.packagingInput !== null))) {
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
  for (const item of manifest.inventory) {
    if (item.kind !== 'symlink') continue
    const resolvedPath = resolve(root, item.path, '..', item.target)
    const realRoot = await realpath(root)
    const resolvedReal = await realpath(resolvedPath)
    const rel = relative(realRoot, resolvedReal)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`symlink escapes artifact: ${item.path}`)
  }
}
