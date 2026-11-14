// Homebrew distributes the existing notarized app; it does not build another one.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { desktopVersion } from '../desktop-version.ts'

const repository = 'tryapparent/apparent'
const tapRepository = 'tryapparent/homebrew-tap'
const caskPath = 'Casks/apparent.rb'
type Release = { draft: boolean; tag_name: string; assets: { name: string; browser_download_url: string; digest: string | null }[] }

export function releaseVersion(tag: string): string {
  const parts = /^preview-mac-(\d+)-(\d+)(?:-(\d+))?$/.exec(tag)
  if (!parts) throw Error('Expected a numbered Mac preview tag')
  const version = parts[3] === undefined ? `0.${parts[1]}.${parts[2]}` : parts.slice(1).join('.')
  if (desktopVersion(`[package]\nversion="${version}"\n`).macTag !== tag) throw Error('Noncanonical Mac preview tag')
  return version
}

export function homebrewCask(version: string, checksum: string): string {
  const { macTag } = desktopVersion(`[package]\nversion="${version}"\n`)
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw Error('Expected a SHA-256 checksum')
  return `cask "apparent" do
  version "${version}"
  sha256 "${checksum}"

  url "https://github.com/${repository}/releases/download/${macTag}/Apparent-Preview-#{version}-arm64.dmg",
      verified: "github.com/${repository}/"
  name "Apparent Preview"
  desc "Record your screen, voice, and annotations for coding agents"
  homepage "https://tryapparent.com/"

  livecheck do
    url "https://raw.githubusercontent.com/${repository}/preview-mac-feed/appcast.xml"
    strategy :sparkle
  end

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :sequoia

  app "Apparent Preview.app"
end
`
}

export function verifiedCask(tag: string, release: Release, checksumFile: string, actualChecksum: string): string {
  const version = releaseVersion(tag)
  if (release.draft || release.tag_name !== tag) throw Error('Expected the published Mac release')
  const name = `Apparent-Preview-${version}-arm64.dmg`
  const url = `https://github.com/${repository}/releases/download/${tag}/${name}`
  const asset = release.assets.filter(asset => asset.name === name)
  const checksumAsset = release.assets.filter(asset => asset.name === `${name}.sha256`)
  if (asset.length !== 1 || asset[0].browser_download_url !== url ||
      checksumAsset.length !== 1 || checksumAsset[0].browser_download_url !== `${url}.sha256`) {
    throw Error('Missing canonical Mac DMG or checksum asset')
  }
  const expected = /^([a-f0-9]{64}) [ *]([^\r\n]+)\r?\n?$/.exec(checksumFile)
  if (!expected || expected[2] !== name || expected[1] !== actualChecksum ||
      asset[0].digest !== `sha256:${actualChecksum}`) throw Error('Published DMG checksum mismatch')
  return homebrewCask(version, actualChecksum)
}

export function assertCaskUpdate(previous: string | null, candidate: string): void {
  const identity = (text: string) => {
    const version = /^  version "([^"]+)"$/m.exec(text)?.[1]
    const checksum = /^  sha256 "([a-f0-9]{64})"$/m.exec(text)?.[1]
    if (!version || !checksum) throw Error('Unrecognized Apparent cask')
    desktopVersion(`[package]\nversion="${version}"\n`)
    return { version, checksum }
  }
  const next = identity(candidate)
  if (candidate !== homebrewCask(next.version, next.checksum)) throw Error('Candidate differs from the canonical cask')
  if (previous === null) return
  const old = identity(previous)
  const a = old.version.split('.').map(BigInt)
  const b = next.version.split('.').map(BigInt)
  for (let index = 0; index < a.length; index++) {
    if (b[index] > a[index]) return
    if (b[index] < a[index]) throw Error('Refusing to downgrade the Homebrew cask')
  }
  if (old.checksum !== next.checksum) throw Error('Refusing to replace an existing version with another checksum')
}

const gh = (args: string[]) => execFileSync('gh', args, { encoding: 'utf8', timeout: 120_000 })

async function prepare(tag: string, expectedSha: string, output: string): Promise<void> {
  const version = releaseVersion(tag)
  const ref = JSON.parse(gh(['api', `repos/${repository}/git/ref/tags/${tag}`]))
  if (ref.object?.type !== 'commit' || !/^[a-f0-9]{40}$/.test(ref.object.sha) ||
      (expectedSha && ref.object.sha !== expectedSha)) throw Error('Mac release tag does not match its source commit')
  const release: Release = JSON.parse(gh(['api', `repos/${repository}/releases/tags/${tag}`]))
  const directory = mkdtempSync(join(tmpdir(), 'apparent-homebrew-'))
  const name = `Apparent-Preview-${version}-arm64.dmg`
  try {
    gh(['release', 'download', tag, '--repo', repository, '--pattern', name, '--pattern', `${name}.sha256`, '--dir', directory])
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk)
    const cask = verifiedCask(tag, release, readFileSync(join(directory, `${name}.sha256`), 'utf8'), hash.digest('hex'))
    writeFileSync(output, cask)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

export function publish(tap: string, candidate: string): void {
  const git = (args: string[]) => execFileSync('git', ['-C', tap, ...args], { encoding: 'utf8', timeout: 120_000 })
  const remote = git(['config', '--get', 'remote.origin.url']).trim()
  if (![`git@github.com:${tapRepository}.git`, `https://github.com/${tapRepository}.git`].includes(remote) ||
      git(['branch', '--show-current']).trim() !== 'main' || git(['status', '--porcelain']).trim()) {
    throw Error('Expected a clean main checkout of the Apparent tap')
  }
  const path = join(tap, caskPath)
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null
  assertCaskUpdate(previous, candidate)
  if (previous !== candidate) {
    mkdirSync(join(tap, 'Casks'), { recursive: true })
    writeFileSync(path, candidate)
    git(['add', '--', caskPath])
    git(['-c', 'user.name=apparent-release', '-c', 'user.email=apparent-release@users.noreply.github.com',
      'commit', '-m', `Update Apparent to ${/^  version "([^"]+)"$/m.exec(candidate)![1]}`])
    // Ordinary fast-forward push refuses a concurrent publisher; never force it.
    git(['push', 'origin', 'HEAD:refs/heads/main'])
  }
  git(['fetch', '--no-tags', 'origin', 'main'])
  if (git(['show', 'FETCH_HEAD:' + caskPath]) !== candidate) throw Error('Published cask readback differs')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'prepare' && args.length === 3) await prepare(args[0], args[1], args[2])
  else if (command === 'publish' && args.length === 2) publish(args[0], readFileSync(args[1], 'utf8'))
  else throw Error('Usage: publish.ts prepare <tag> <expected-sha-or-empty> <output> | publish <tap> <cask>')
}
