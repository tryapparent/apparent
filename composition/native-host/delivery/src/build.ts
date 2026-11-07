import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { inventoryTree, selectTarget, validateArtifact, type DeliveryManifest } from './contract.ts'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: packageRoot, encoding: 'utf8' }).trim()
const output = resolve(packageRoot, 'dist')
const target = selectTarget(process.env.OWNER_TARGET, process.platform, process.arch)

function cleanSource() {
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repo, encoding: 'utf8' })
  if (status) throw new Error('GUI delivery build requires clean tracked and untracked source')
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repo, encoding: 'utf8' }).trim(),
  }
}

function refuseExistingDirectory(path: string) {
  if (existsSync(path)) throw new Error(`refusing to replace existing build output: ${path}`)
}

const source = cleanSource()
refuseExistingDirectory(output)
mkdirSync(output, { recursive: false })
const temporary = mkdtempSync(join(tmpdir(), 'apparent-native-host-build-'))
let ownedLinuxOutput: string | undefined
let packagingInput: DeliveryManifest['packagingInput'] = null
try {
  const executable = target === 'linux-x64' ? 'Apparent-x86_64.AppImage' : 'Apparent.app/Contents/MacOS/apparent'
  const entry = target === 'linux-x64' ? executable : executable
  const launch = target === 'linux-x64' ? 'execute-appimage' : 'launch-services-open'
  const targetDir = resolve(repo, 'target/appimage')

  if (target === 'linux-x64') {
    refuseExistingDirectory(targetDir)
    ownedLinuxOutput = targetDir
    execFileSync('cargo', ['build', '--bin', 'apparent'], { cwd: repo, stdio: 'inherit' })
    const binary = resolve(repo, 'target/debug/apparent')
    const binaryBytes = readFileSync(binary)
    packagingInput = {
      path: 'target/debug/apparent',
      mode: lstatSync(binary).mode & 0o777,
      sha256: createHash('sha256').update(binaryBytes).digest('hex'),
    }
    const tools = resolve(temporary, 'packaging-tools')
    const toolsManifest = resolve(temporary, 'packaging-tools.json')
    execFileSync('bash', [resolve(repo, 'capture/desktop/scripts/linux/appimage/appimage.sh'), binary], {
      cwd: repo,
      stdio: 'inherit',
      env: { ...process.env, APPARENT_PACKAGING_TOOLS_DIR: tools, APPARENT_PACKAGING_TOOLS_MANIFEST: toolsManifest },
    })
    const appImage = resolve(targetDir, executable)
    writeFileSync(resolve(output, executable), readFileSync(appImage), { flag: 'wx', mode: 0o755 })
    chmodSync(resolve(output, executable), 0o755)
  } else {
    const home = join(temporary, 'home')
    const app = join(temporary, 'Apparent.app')
    const sparkle = join(temporary, 'sparkle')
    mkdirSync(home)
    const env = {
      ...process.env,
      HOME: home,
      CARGO_HOME: process.env.CARGO_HOME ?? join(process.env.HOME ?? '', '.cargo'),
      APPARENT_APP_DIR: app,
      APPARENT_NO_LAUNCH: '1',
      APPARENT_SPARKLE_DIR: sparkle,
    }
    const installer = spawnSync('bash', [resolve(repo, 'capture/desktop/scripts/packaging/install-app.sh')], { cwd: repo, env, stdio: 'inherit' })
    if (installer.status !== 0) throw new Error(`Mac GUI packaging failed (${installer.status ?? installer.signal})`)
    // Preserve framework-relative links: copy the whole .app tree, not a flattened archive.
    execFileSync('ditto', [app, resolve(output, 'Apparent.app')], { stdio: 'inherit' })
  }

  const manifest: DeliveryManifest = {
    schema: 1,
    id: 'platform-native-host',
    source,
    target,
    profile: 'development-app',
    buildProfile: 'debug',
    entry,
    launch,
    buildEnvironment: {
      os: process.platform as 'linux' | 'darwin',
      arch: process.arch as 'x64',
      cargo: execFileSync('cargo', ['--version'], { encoding: 'utf8' }).trim(),
      rustc: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(),
    },
    packagingInput,
    processProfile: {
      home: 'trusted-launch-home',
      config: 'APPARENT_CONFIG-or-HOME/.config/apparent/config.json',
      socket: 'HOME/.config/apparent/agent-control/capture.sock',
    },
    inventory: await inventoryTree(output),
  }
  writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx', mode: 0o644 })
  await validateArtifact(output, manifest)
  if (JSON.stringify(cleanSource()) !== JSON.stringify(source)) throw new Error('source identity changed during GUI packaging')
  console.log(`Existing root GUI staged for ${target}: ${output}`)
} catch (error) {
  if (existsSync(output) && lstatSync(output).isDirectory()) rmSync(output, { recursive: true, force: true })
  throw error
} finally {
  rmSync(temporary, { recursive: true, force: true })
  // The existing packager uses a fixed target path. It was required to be absent before this
  // invocation; remove it only when its complete top-level inventory is exactly ours.
  if (ownedLinuxOutput && existsSync(output) && existsSync(resolve(output, 'manifest.json'))) {
    const names = readdirSync(ownedLinuxOutput).sort()
    if (JSON.stringify(names) === JSON.stringify(['AppDir', 'Apparent-x86_64.AppImage'])) {
      rmSync(ownedLinuxOutput, { recursive: true, force: true })
    }
  }
}
