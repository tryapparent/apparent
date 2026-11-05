import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const workflow = readFileSync(new URL('../../../../../.github/workflows/release-linux.yml', import.meta.url), 'utf8')
const linux = workflow.split('  linux:\n')[1]?.split('\n  publish:\n')[0]
assert.ok(linux, 'release-linux must retain its linux packaging job')

function step(name: string): string {
  const marker = `      - name: ${name}\n`
  const start = linux.indexOf(marker)
  assert.notEqual(start, -1, `missing workflow step: ${name}`)
  const rest = linux.slice(start + marker.length)
  const end = rest.search(/^      - /m)
  return end < 0 ? rest : rest.slice(0, end)
}

test('Linux release caches use bounded paths and exact immutable identities', () => {
  const paths = step('Configure release cache paths')
  assert.ok(paths.includes('echo "APPARENT_TEST_MODEL_DIR=$RUNNER_TEMP/speech-model" >> "$GITHUB_ENV"'))
  assert.ok(paths.includes('echo "APPARENT_PACKAGING_TOOLS_MANIFEST=$RUNNER_TEMP/packaging-tools.json" >> "$GITHUB_ENV"'))
  assert.ok(paths.includes('echo "APPARENT_PACKAGING_TOOLS_DIR=$RUNNER_TEMP/packaging-tools" >> "$GITHUB_ENV"'))

  const node = linux.slice(linux.indexOf('      - uses: actions/setup-node@v4'))
    .split('\n      - ')[0]
  assert.match(node, /node-version: '22\.23\.0'/)
  assert.match(node, /cache: npm/)
  assert.match(node, /cache-dependency-path: capture\/desktop\/ui\/frontend\/package-lock\.json/)

  const rendererInstall = step('Install Desktop renderer dependencies')
  assert.match(rendererInstall, /ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --prefix capture\/desktop\/ui\/frontend/)
  const rendererBuild = step('Build source-bound Desktop renderer artifact')
  assert.match(rendererBuild, /renderer-artifact\.ts build/)
  assert.match(rendererBuild, /tar -xOzf "\$archive" manifest\.json/)
  assert.match(rendererBuild, /\.source\.gitHead/)
  assert.match(rendererBuild, /\.source\.gitDirty/)
  assert.match(rendererBuild, /\.sourceInputSha256/)
  assert.match(rendererBuild, /APPARENT_DESKTOP_RENDERER_ARCHIVE=/)
  assert.match(rendererBuild, /APPARENT_DESKTOP_RENDERER_SHA256=/)
  assert.match(rendererBuild, /APPARENT_DESKTOP_RENDERER_SOURCE_SHA=/)
  assert.ok(linux.indexOf('      - name: Build source-bound Desktop renderer artifact') < linux.indexOf('      - name: Package\n'))

  const model = step('Cache verified speech model')
  assert.match(model, /uses: actions\/cache@v4/)
  assert.match(model, /path: \$\{\{ runner\.temp \}\}\/speech-model/)
  assert.match(model, /key: release-linux-speech-model-\$\{\{ hashFiles\('capture\/engine\/runtime\/audio\/transcription\/speech\.rs'\) \}\}/)
  assert.doesNotMatch(model, /restore-keys:/)

  const electron = step('Cache Electron download')
  assert.match(electron, /path: ~\/\.cache\/electron/)
  assert.match(electron, /key: release-linux-electron-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-\$\{\{ hashFiles\('capture\/desktop\/ui\/frontend\/package-lock\.json'\) \}\}/)
  assert.doesNotMatch(electron, /restore-keys:/)

  const resolver = step('Resolve pinned packaging tools')
  assert.match(resolver, /id: packaging-tools/)
  assert.match(resolver, /node --experimental-strip-types capture\/desktop\/scripts\/linux\/appimage\/packaging-tools\.ts resolve "\$RUNNER_TEMP\/packaging-tools\.json" "\$GITHUB_OUTPUT"/)
  assert.doesNotMatch(resolver, /GH_TOKEN:/)

  const tools = step('Cache verified packaging tools')
  assert.match(tools, /path: \$\{\{ runner\.temp \}\}\/packaging-tools/)
  assert.match(tools, /key: release-linux-packaging-tools-\$\{\{ matrix\.arch \}\}-\$\{\{ steps\.packaging-tools\.outputs\.key \}\}/)
  assert.doesNotMatch(tools, /restore-keys:/)
  assert.ok(linux.indexOf('      - name: Resolve pinned packaging tools') < linux.indexOf('      - name: Cache verified packaging tools'))
  assert.ok(linux.indexOf('      - name: Cache verified packaging tools') < linux.indexOf('      - name: Package\n'))
})

test('Linux renderer-only release admits a sealed prior root before every native build', () => {
  const lookup = step('Find the latest retained Linux native release inputs')
  assert.match(lookup, /--workflow release-linux\.yml --branch main --status success/)
  assert.match(lookup, /inspection-release-\$\{ARCH\}-\$\{source_sha\}/)
  assert.match(lookup, /actions\/runs\/\$run_id\/artifacts/)

  const download = linux.slice(linux.indexOf('      - uses: actions/download-artifact@v5'))
    .split('\n      - ')[0]
  assert.match(download, /run-id: \$\{\{ steps\.root-artifact\.outputs\.run_id \}\}/)
  assert.match(download, /github-token: \$\{\{ github\.token \}\}/)

  const admission = step('Admit compatible retained Linux native inputs')
  assert.match(admission, /rootProfile release/)
  assert.match(admission, /expected_target="\$\{ARCH\}-unknown-linux-gnu"/)
  assert.match(admission, /Current release toolchain differs from the retained root/)
  assert.ok(admission.indexOf('gh attestation verify "$receipt"') < admission.indexOf('rustc_version='),
    'Authenticate the receipt before using its recorded toolchain identity')
  assert.match(admission, /gh attestation verify "\$inspector"/)
  assert.match(admission, /gh attestation verify "\$speech_test"/)
  assert.match(admission, /rustc -vV/)
  assert.match(admission, /cargo -V/)
  assert.match(admission, /APPARENT_INSPECTION_REQUIRED_PROFILE=release/)
  assert.match(admission, /composition\.ts reuse/)
  assert.match(admission, /attestation verify "\$speech_test"/)
  assert.match(admission, /source-digest "\$root_source"/)
  assert.match(admission, /Retained native inputs failed release admission; compiling a fresh native baseline/)

  for (const name of [
    'Build with PostHog error reporting',
    'Compile packaged model test executable',
    'No build-machine CPU specialization',
  ]) {
    assert.match(step(name), /if: steps\.root-reuse\.outputs\.reuse != 'true'/, `${name} must be skipped after reuse`)
  }
  assert.match(step('Forbid native rebuild after Linux root reuse'), /cargo rustc rustup cmake clang/)
  assert.ok(linux.indexOf('      - name: Admit compatible retained Linux native inputs') < linux.indexOf('      - name: Forbid native rebuild after Linux root reuse'))
  assert.ok(linux.indexOf('      - name: Forbid native rebuild after Linux root reuse') < linux.indexOf('      - name: Build with PostHog error reporting'))
  assert.match(step('CPU tiers contain only their declared instructions'), /APPARENT_REUSED_ROOT_DIRECTORY:-target\/release/)
  assert.match(step('Package'), /GH_TOKEN: \$\{\{ github\.token \}\}/)

  const retain = step('Retain release-profile composition inputs')
  assert.match(retain, /steps\.root-reuse\.outputs\.reuse != 'true'/)
  assert.match(retain, /inspection-release\/speech-test/)
  const attest = linux.slice(linux.indexOf('      - uses: actions/attest-build-provenance@v2'))
    .split('\n      - ')[0]
  assert.match(attest, /inspection-release\/speech-test/)
  assert.match(attest, /steps\.root-reuse\.outputs\.reuse != 'true'/)
})

test('Mac preview builds and passes the exact source-bound renderer to app packaging', () => {
  const mac = readFileSync(new URL('../../../../../.github/workflows/release-mac-preview.yml', import.meta.url), 'utf8')
  const install = mac.split('      - name: Install Desktop renderer dependencies\n')[1]?.split('\n      - ')[0]
  const build = mac.split('      - name: Build source-bound Desktop renderer artifact\n')[1]?.split('\n      - ')[0]
  assert.ok(install && build)
  assert.match(install, /ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --prefix capture\/desktop\/ui\/frontend/)
  assert.match(build, /renderer-artifact\.ts build/)
  assert.match(build, /tar -xOzf "\$archive" manifest\.json/)
  assert.match(build, /\.source\.gitHead/)
  assert.match(build, /\.source\.gitDirty/)
  assert.match(build, /\.sourceInputSha256/)
  assert.match(build, /APPARENT_DESKTOP_RENDERER_ARCHIVE=/)
  assert.match(build, /APPARENT_DESKTOP_RENDERER_SHA256=/)
  assert.match(build, /APPARENT_DESKTOP_RENDERER_SOURCE_SHA=/)
  assert.ok(mac.indexOf('      - name: Build source-bound Desktop renderer artifact') < mac.indexOf('      - name: Build and verify the preview app\n'))

  const lookup = mac.split('      - name: Find the latest retained Mac preview native release inputs\n')[1]?.split('\n      - ')[0]
  const admission = mac.split('      - name: Admit compatible retained Mac preview native inputs\n')[1]?.split('\n      - ')[0]
  assert.ok(lookup && admission)
  assert.match(lookup, /--workflow release-mac-preview\.yml --branch main --status success/)
  assert.match(lookup, /inspection-preview-root-\$\{source_sha\}/)
  assert.match(admission, /APPARENT_PREVIEW_BUILD=1 APPARENT_HELPER_BUNDLE_ID=dev\.simonvanlaak\.apparent\.preview\.helper/)
  assert.match(admission, /APPARENT_INSPECTION_REQUIRED_PROFILE=release/)
  assert.match(admission, /expected_target=aarch64-apple-darwin/)
  assert.match(admission, /Current Mac release toolchain differs from the retained root/)
  assert.ok(admission.indexOf('gh attestation verify "$receipt"') < admission.indexOf('rustc_version='),
    'Authenticate the receipt before using its recorded toolchain identity')
  assert.match(admission, /gh attestation verify "\$inspector"/)
  assert.match(admission, /rustc -vV/)
  assert.match(admission, /cargo -V/)
  assert.match(admission, /composition\.ts reuse/)
  assert.match(mac, /Forbid native rebuild after Mac root reuse/)
  assert.ok(mac.indexOf('      - name: Admit compatible retained Mac preview native inputs') < mac.indexOf('      - name: Forbid native rebuild after Mac root reuse'))
  assert.ok(mac.indexOf('      - name: Forbid native rebuild after Mac root reuse') < mac.indexOf('      - name: Build and verify the preview app'))
  assert.match(mac, /steps\.root-reuse\.outputs\.reuse != 'true'/)
  assert.match(mac, /Retain preview-root composition inputs[\s\S]*?APPARENT_PREVIEW_BUILD: '1'[\s\S]*?APPARENT_HELPER_BUNDLE_ID: dev\.simonvanlaak\.apparent\.preview\.helper/)
})

test('cache hits cannot skip smoke gates or change release admission', () => {
  assert.doesNotMatch(linux, /cache-hit/)
  for (const name of [
    'AppImage runs headless without FUSE',
    'Bundled GStreamer decodes an H.264 MP4',
    'Bundled GStreamer encodes a playable H.264 MP4',
    'Run two seconds of audio with the packaged CPU backend',
  ]) {
    const gate = step(name)
    assert.doesNotMatch(gate, /^\s+if:/m, `${name} must run on cache hits and misses`)
    assert.match(gate, /\brun:/)
  }
  const packagedModel = step('Run two seconds of audio with the packaged CPU backend')
  assert.match(packagedModel, /smoke-cpu\.sh "dist\/\$\{\{ steps\.package\.outputs\.name \}\}" "\$SPEECH_TEST"/)
  assert.match(linux, /name: Run packaged model on Ice Lake \(AVX512-VNNI, no AVX-VNNI\)/)
  assert.match(linux, /\.\/capture\/desktop\/scripts\/linux\/appimage\/appimage\.sh target\/release\/apparent/)

  const publish = workflow.split('  publish:\n')[1]
  assert.ok(publish)
  assert.match(workflow, /needs: \[admit, preview-needed, linux\]/)
  assert.match(workflow, /if: always\(\) && needs\.admit\.result == 'success'.*needs\.linux\.result == 'success'/)
  assert.match(publish, /name: Publish admitted immutable artifact identities and complete ancestry/)
  assert.match(publish, /name: Publish unchanged verified assets/)
})


for (const platform of ['linux', 'mac']) {
  test(`${platform} executes the committed artifact selector with paginated CLI results`, () => {
    const text = readFileSync(new URL(`../../../../../.github/workflows/${platform === 'linux' ? 'release-linux.yml' : 'release-mac-preview.yml'}`, import.meta.url), 'utf8')
    const marker = `      - name: Find the latest retained ${platform === 'linux' ? 'Linux native release inputs' : 'Mac preview native release inputs'}\n`
    const start = text.indexOf(marker)
    assert(start >= 0)
    const rest = text.slice(start + marker.length)
    const end = rest.search(/^      - /m)
    const section = end < 0 ? rest : rest.slice(0, end)
    const body = section.split('        run: |\n')[1]
    assert(body)
    const script = body.split('\n').map(line => line.slice(10)).join('\n')
    const work = mkdtempSync(join(tmpdir(), 'renderer-selector-'))
    try {
      const bin = join(work, 'bin'); mkdirSync(bin)
      // Controlled API output tests command ordering and filtering, not real provenance.
      writeFileSync(join(bin, 'gh'), '#!/usr/bin/env bash\nset -euo pipefail\ncase "$1" in\nrun) printf "123\\t%s\\n" "$FIXTURE_SHA";;\napi) test "$#" = 3; test "$2" = --paginate; cat "$FIXTURE_RESPONSE";;\n*) exit 9;;\nesac\n', { mode: 0o755 })
      const source = 'a'.repeat(40)
      const name = platform === 'linux' ? `inspection-release-x86_64-${source}` : `inspection-preview-root-${source}`
      const response = join(work, 'pages.json')
      const output = join(work, 'output')
      for (const matching of [true, false]) {
        writeFileSync(response, JSON.stringify({ artifacts: [{ name, expired: true }] }) + '\n' + JSON.stringify({ artifacts: [{ name: matching ? name : 'other', expired: false }] }))
        writeFileSync(output, '')
        const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'tryapparent/apparent', GITHUB_OUTPUT: output, ARCH: 'x86_64', FIXTURE_SHA: source, FIXTURE_RESPONSE: response } })
        assert.equal(result.status, 0, result.stderr)
        assert.equal(readFileSync(output, 'utf8'), matching ? `run_id=123\nartifact=${name}\n` : '')
      }
    } finally { rmSync(work, { recursive: true, force: true }) }
  })
}
