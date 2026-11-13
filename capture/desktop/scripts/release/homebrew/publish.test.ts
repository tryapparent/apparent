import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assertCaskUpdate, homebrewCask, publish, releaseVersion, verifiedCask } from './publish.ts'

const tag = 'preview-mac-22-2'
const version = '0.22.2'
const checksum = createHash('sha256').update('synthetic DMG bytes').digest('hex')
const name = `Apparent-Preview-${version}-arm64.dmg`
const url = `https://github.com/tryapparent/apparent/releases/download/${tag}/${name}`
const release = { draft: false, tag_name: tag, assets: [
  { name, browser_download_url: url, digest: `sha256:${checksum}` },
  { name: `${name}.sha256`, browser_download_url: `${url}.sha256`, digest: null },
] }
const sum = `${checksum}  ${name}\n`

test('cask pins the published DMG while preserving the preview identity and Sparkle updates', () => {
  const cask = verifiedCask(tag, release, sum, checksum)
  assert.equal(cask, homebrewCask(version, checksum))
  assert.match(cask, /app "Apparent Preview.app"/)
  assert.match(cask, /auto_updates true/)
  assert.match(cask, /depends_on arch: :arm64/)
  assert.match(cask, /^  depends_on macos: :sequoia$/m)
  assert.match(cask, /preview-mac-feed\/appcast.xml/)
  assert.doesNotMatch(cask, /:no_check|:latest|\bbinary\b|\bzap\b|\binstaller\b|\bpostflight\b/)
})

test('release identity accepts the existing 0.x and later numbered tags without injection', () => {
  assert.equal(releaseVersion(tag), version)
  assert.equal(releaseVersion('preview-mac-1-2-3'), '1.2.3')
  for (const invalid of ['v0.22.2', 'preview-mac-0-22-2', 'preview-mac-022-2', 'preview-mac-22-2/other', 'preview-mac-22-2\n']) {
    assert.throws(() => releaseVersion(invalid))
  }
  assert.throws(() => homebrewCask('0.22.2\nmalicious', checksum))
  assert.throws(() => homebrewCask(version, 'bad'))
})

test('missing, substituted, draft, and corrupted release assets cannot become an installable cask', () => {
  for (const changed of [
    { ...release, draft: true }, { ...release, tag_name: 'preview-mac-22-1' },
    { ...release, assets: release.assets.slice(1) },
    { ...release, assets: release.assets.slice(0, 1) },
    { ...release, assets: [...release.assets, release.assets[0]] },
    { ...release, assets: [{ ...release.assets[0], browser_download_url: 'https://example.com/untrusted.dmg' }, release.assets[1]] },
    { ...release, assets: [{ ...release.assets[0], digest: `sha256:${'a'.repeat(64)}` }, release.assets[1]] },
  ]) assert.throws(() => verifiedCask(tag, changed, sum, checksum))
  for (const bad of ['', `${checksum}  other.dmg\n`, sum + 'extra\n', `${'a'.repeat(64)}  ${name}\n`]) {
    assert.throws(() => verifiedCask(tag, release, bad, checksum))
  }
  assert.throws(() => verifiedCask(tag, release, sum, 'b'.repeat(64)))
})

test('publishing is monotonic and repeatable without silently accepting a retagged version', () => {
  const cask = homebrewCask(version, checksum)
  assertCaskUpdate(null, cask)
  assertCaskUpdate(cask, cask)
  assertCaskUpdate(homebrewCask('0.9.9', checksum), cask)
  assertCaskUpdate(cask, homebrewCask('1.0.0', checksum))
  assert.throws(() => assertCaskUpdate(cask, homebrewCask('0.22.1', checksum)), /downgrade/)
  assert.throws(() => assertCaskUpdate(cask, homebrewCask(version, 'a'.repeat(64))), /another checksum/)
  assert.throws(() => assertCaskUpdate(cask, cask + '\npostflight do\nend\n'), /canonical/)
  assert.throws(() => assertCaskUpdate('unrecognized existing file', cask), /Unrecognized/)
})

test('real Git publication pushes only the cask, verifies readback, and makes repeats a no-op', () => {
  const directory = mkdtempSync(join(tmpdir(), 'homebrew-publication-'))
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
  const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const remote = join(directory, 'remote.git')
  const tap = join(directory, 'tap')
  try {
    mkdirSync(remote)
    mkdirSync(tap)
    git(remote, ['init', '--bare', '--initial-branch=main'])
    git(tap, ['init', '--initial-branch=main'])
    git(tap, ['config', 'user.name', 'fixture'])
    git(tap, ['config', 'user.email', 'fixture@example.invalid'])
    git(tap, ['config', 'core.hooksPath', '/dev/null'])
    git(tap, ['remote', 'add', 'origin', 'https://github.com/tryapparent/homebrew-tap.git'])
    git(tap, ['config', `url.${remote}.insteadOf`, 'https://github.com/tryapparent/homebrew-tap.git'])
    writeFileSync(join(tap, 'README.md'), 'Tap fixture\n')
    git(tap, ['add', 'README.md'])
    git(tap, ['commit', '-m', 'Initialize tap'])
    git(tap, ['push', 'origin', 'main'])
    const before = git(tap, ['rev-parse', 'HEAD'])
    const cask = homebrewCask(version, checksum)
    publish(tap, cask)
    const after = git(remote, ['rev-parse', 'main'])
    assert.notEqual(after, before)
    assert.equal(git(tap, ['diff-tree', '--no-commit-id', '--name-only', '-r', after]), 'Casks/apparent.rb')
    assert.equal(git(remote, ['show', 'main:Casks/apparent.rb']), cask.trim())
    publish(tap, cask)
    assert.equal(git(remote, ['rev-parse', 'main']), after)
    assert.throws(() => publish(tap, homebrewCask('0.22.1', checksum)), /downgrade/)
    assert.equal(git(remote, ['rev-parse', 'main']), after)

    // A second publisher advancing main makes an ordinary push fail, never force.
    const other = join(directory, 'other')
    git(directory, ['clone', remote, other])
    writeFileSync(join(other, 'Casks/apparent.rb'), homebrewCask('0.24.0', checksum))
    git(other, ['add', '.'])
    git(other, ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Concurrent release'])
    git(other, ['push', 'origin', 'main'])
    assert.throws(() => publish(tap, homebrewCask('0.23.0', checksum)))
    assert.match(git(remote, ['show', 'main:Casks/apparent.rb']), /version "0.24.0"/)
    assert.equal(readFileSync(join(tap, 'README.md'), 'utf8'), 'Tap fixture\n')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('release workflow limits Homebrew to main, verifies install before loading the write credential, and supports retries', () => {
  const workflow = readFileSync(new URL('../../../../../.github/workflows/release-mac-preview.yml', import.meta.url), 'utf8')
  const job = workflow.slice(workflow.indexOf('\n  homebrew:\n'))
  assert.match(job, /needs: preview/)
  assert.match(job, /github.ref == 'refs\/heads\/main'/)
  assert.match(job, /needs.preview.result == 'success'/)
  assert.match(job, /needs.preview.result == 'skipped' && inputs.homebrew_tag != ''/)
  assert.ok(job.indexOf('brew uninstall --cask') < job.indexOf('ssh-key:'))
  assert.ok(job.indexOf('spctl --assess') < job.indexOf('homebrew/publish.ts publish'))
  assert.match(job, /RELEASE_SHA: \$\{\{ needs.preview.outputs.sha \}\}/)
  assert.doesNotMatch(job, /--no-quarantine|--force|--zap/)
})
