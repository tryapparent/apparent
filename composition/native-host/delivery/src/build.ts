import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { inventoryTree, readProducerFile, selectTarget, validateArtifact, type DeliveryManifest } from './contract.ts'
import { checkNativeExecutable, compiledGuiPath, compiledHelperPath, preparedLinuxTools } from './build-input.ts'

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
const preparedTools = target === 'linux-x64' ? await preparedLinuxTools(process.env) : null
refuseExistingDirectory(output)
mkdirSync(output, { recursive: false })
const temporary = mkdtempSync(join(tmpdir(), 'apparent-native-host-build-'))
let ownedLinuxOutput: string | undefined
let packagingInput: DeliveryManifest['packagingInput'] = null
let guiExecutable: DeliveryManifest['guiExecutable']
try {
  const executable = target === 'linux-x64' ? 'Apparent-x86_64.AppImage' : 'Apparent.app/Contents/MacOS/apparent'
  const entry = executable
  const launch = target === 'linux-x64' ? 'execute-appimage' : 'launch-services-open'
  const targetDir = resolve(repo, 'target/appimage')

  const transcript = execFileSync('cargo', ['build', '--locked', '--bin', 'apparent', '--message-format=json'], {
    cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, CARGO_BUILD_JOBS: process.env.T3_BUILD_JOBS ?? process.env.CARGO_BUILD_JOBS ?? '3' },
  })
  const binary = compiledGuiPath(repo, transcript)
  const built = await readProducerFile(binary)
  checkNativeExecutable(built.bytes, target)

  if (target === 'linux-x64') {
    refuseExistingDirectory(targetDir)
    ownedLinuxOutput = targetDir
    packagingInput = {
      path: 'target/debug/apparent',
      mode: built.mode,
      sha256: createHash('sha256').update(built.bytes).digest('hex'),
    }
    const tools = resolve(temporary, 'packaging-tools')
    const toolsManifest = resolve(temporary, 'packaging-tools.json')
    writeFileSync(toolsManifest, preparedTools!.bytes, { flag: 'wx', mode: 0o600 })
    execFileSync('bash', [resolve(repo, 'capture/desktop/scripts/linux/appimage/appimage.sh'), binary], {
      cwd: repo,
      stdio: 'inherit',
      env: { ...process.env, APPARENT_PACKAGING_TOOLS_DIR: tools, APPARENT_PACKAGING_TOOLS_MANIFEST: toolsManifest },
    })
    const appImage = resolve(targetDir, executable)
    writeFileSync(resolve(output, executable), readFileSync(appImage), { flag: 'wx', mode: 0o755 })
    chmodSync(resolve(output, executable), 0o755)
    const unpack = join(temporary, 'appimage-extraction')
    mkdirSync(unpack)
    const extractEnv = { ...process.env }
    delete extractEnv.APPIMAGE_EXTRACT_AND_RUN
    execFileSync(appImage, ['--appimage-extract'], { cwd: unpack, env: extractEnv, stdio: ['ignore', 'ignore', 'inherit'] })
    const packaged = await readProducerFile(join(unpack, 'squashfs-root/usr/bin/apparent'))
    checkNativeExecutable(packaged.bytes, target)
    guiExecutable = { container: 'appimage', path: 'usr/bin/apparent', mode: packaged.mode,
      sha256: createHash('sha256').update(packaged.bytes).digest('hex') }
  } else {
    const app = join(temporary, 'Apparent.app')
    const sparkle = join(temporary, 'sparkle')
    const helper = await readProducerFile(compiledHelperPath(repo, transcript))
    checkNativeExecutable(helper.bytes, target)
    const inputs = join(temporary, 'validated-inputs')
    mkdirSync(inputs, { mode: 0o700 })
    for (const [name, snapshot] of [['apparent', built], ['apparent-helper', helper]] as const) {
      writeFileSync(join(inputs, name), snapshot.bytes, { flag: 'wx', mode: 0o755 })
      chmodSync(join(inputs, name), 0o755)
    }
    const installer = resolve(repo, 'capture/desktop/scripts/packaging/install-app.sh')
    // Source the existing stager directly: the executable installer entry still
    // requires its normal compile or immutable-main artifact admission.
    execFileSync('bash', ['-c', 'source "$1"; apparent_stage_built_app "$2" "$3" "$4" "$5"',
      'native-host-staging', installer, repo, inputs, app,
      execFileSync('bash', [resolve(repo, 'capture/desktop/scripts/release/setup-sparkle.sh')], {
        cwd: repo, env: { ...process.env, APPARENT_SPARKLE_DIR: sparkle }, encoding: 'utf8',
      }).trim()], { cwd: repo, stdio: 'inherit' })
    // Signing is the only permitted transformation after the stager's byte-for-byte
    // copy check; the immutable input snapshots themselves must remain unchanged.
    for (const [name, snapshot] of [['apparent', built], ['apparent-helper', helper]] as const) {
      if (!(await readProducerFile(join(inputs, name))).bytes.equals(snapshot.bytes)) {
        throw new Error('Validated Mac packaging input changed during staging')
      }
    }
    // Preserve framework-relative links: copy the whole .app tree, not a flattened archive.
    execFileSync('ditto', [app, resolve(output, 'Apparent.app')], { stdio: 'inherit' })
    execFileSync('codesign', ['--verify', '--deep', '--strict', resolve(output, 'Apparent.app')], { stdio: 'inherit' })
    const packaged = await readProducerFile(resolve(output, executable))
    checkNativeExecutable(packaged.bytes, target)
    guiExecutable = { container: 'artifact', path: executable, mode: packaged.mode,
      sha256: createHash('sha256').update(packaged.bytes).digest('hex') }
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
    argv: target === 'linux-x64' ? ['--appimage-extract-and-run', 'app'] : ['app'],
    nativeHostProtocol: 1,
    guiExecutable,
    buildEnvironment: {
      os: process.platform as 'linux' | 'darwin',
      arch: process.arch as 'x64',
      cargo: execFileSync('cargo', ['--version'], { encoding: 'utf8' }).trim(),
      rustc: execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim(),
      packagingToolsSha256: preparedTools?.sha256 ?? null,
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
