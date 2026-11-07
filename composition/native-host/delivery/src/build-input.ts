import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { readProducerFile, type Target } from './contract.ts'

/** Both existing packagers use target/debug; never silently package a stale binary
 * when Cargo's configured output instead went to a cross/custom target directory. */
export function compiledGuiPath(repository: string, transcript: string): string {
  const artifacts = transcript.split('\n').filter(Boolean).map(line => JSON.parse(line) as {
    reason?: string; target?: { name?: string; kind?: string[] }; executable?: string | null
  }).filter(message => message.reason === 'compiler-artifact'
    && message.target?.name === 'apparent' && message.target.kind?.includes('bin') && message.executable)
  const expected = resolve(repository, 'target/debug/apparent')
  if (artifacts.length !== 1 || resolve(artifacts[0].executable!) !== expected) {
    throw new Error('GUI packagers require the current Cargo artifact at target/debug/apparent; custom/cross output is unsupported')
  }
  return expected
}

/** Select the helper from this exact root package's build-script output, including
 * Cargo cache hits. The convenience copy in target/debug can be stale or absent. */
export function compiledHelperPath(repository: string, transcript: string): string {
  const messages = transcript.split('\n').filter(Boolean).map(line => JSON.parse(line) as {
    reason?: string; package_id?: string; target?: { name?: string; kind?: string[] }; out_dir?: string
  })
  const root = messages.filter(message => message.reason === 'compiler-artifact'
    && message.target?.name === 'apparent' && message.target.kind?.includes('bin'))
  const scripts = messages.filter(message => message.reason === 'build-script-executed'
    && root.length === 1 && typeof root[0].package_id === 'string' && message.package_id === root[0].package_id)
  const directory = scripts.length === 1 && scripts[0].out_dir ? resolve(scripts[0].out_dir) : ''
  const base = resolve(repository, 'target/debug/build')
  if (!directory.startsWith(base + '/') || !/^[^/]+\/out$/.test(directory.slice(base.length + 1))) {
    throw new Error('Mac helper requires the current root Cargo build-script output')
  }
  return resolve(directory, 'apparent-helper')
}

export function checkNativeExecutable(bytes: Buffer, target: Target) {
  const valid = bytes.length >= 32 && (target === 'linux-x64'
    ? bytes.readUInt32LE(0) === 0x464c457f && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === 62
    : bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === 0x01000007)
  if (!valid) throw new Error('GUI executable format/architecture does not match the native x64 target')
}

/** Resolve moving upstream tools before delivery fingerprinting; build consumes
 * exactly those bytes rather than querying a possibly changed release again. */
export async function preparedLinuxTools(env: NodeJS.ProcessEnv) {
  const path = env.APPARENT_PACKAGING_TOOLS_MANIFEST
  const expected = env.APPARENT_PACKAGING_TOOLS_SHA256
  if (!path || !isAbsolute(path) || !expected || !/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error('Prepare the official Linux packaging manifest and APPARENT_PACKAGING_TOOLS_SHA256 before delivery fingerprinting')
  }
  const { bytes } = await readProducerFile(path, 4 * 1024 * 1024)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== expected) throw new Error('Prepared packaging tools changed since delivery fingerprinting')
  return { bytes, sha256 }
}
