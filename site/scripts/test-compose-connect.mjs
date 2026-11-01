import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { composeArtifacts, inventory, routes, approved, resourceGraph, safePath } from './compose-connect.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'compose-'))
  const pub = join(root, 'public'), con = join(root, 'connect'), canonical = join(root, 'canonical'), out = join(root, 'out')
  const put = (dir, path, bytes) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), bytes) }
  put(pub, 'index.html', '<script type="module" src="/assets/public-a.js"></script>')
  put(pub, 'assets/public-a.js', 'export const publicPage = true;')
  for (const path of approved) { put(canonical, path, `approved ${path}`); put(con, path, `approved ${path}`) }
  for (const route of routes) put(con, `${route}/index.html`, '<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><meta http-equiv="Cache-Control" content="no-store"><p>Checking your account</p><script type="module" src="/assets/connect-a.js"></script><link rel="modulepreload" href="/assets/preload-a.js"><link rel="stylesheet" href="/assets/connect-a.css">')
  put(con, 'assets/connect-a.js', 'import "./child-a.js"; const preload=["assets/preload-a.js"]; export const origin="https://hosted.tryapparent.com";')
  put(con, 'assets/child-a.js', 'export const child = true;')
  put(con, 'assets/preload-a.js', 'export const preload = true;')
  put(con, 'assets/connect-a.css', '@import "./child-a.css"; a { background: url(/hosted/source-pond-v4.png) }')
  put(con, 'assets/child-a.css', '@font-face { src: url(/HostGrotesk-Variable.ttf) }')
  put(out, 'previous.bin', Buffer.from([0, 42, 255])); put(out, 'nested/sentinel', 'unchanged')
  return { root, pub, con, canonical, out, put, run: options => composeArtifacts(pub, con, canonical, out, options) }
}
const snapshot = root => [...inventory(root)].sort(([a], [b]) => a.localeCompare(b))
test('compose independently emitted routes, preloads, import tables, CSS and identical approved collisions', () => {
  const f = fixture()
  try {
    f.put(f.pub, 'apparent-wordmark.svg', readFileSync(join(f.canonical, 'apparent-wordmark.svg')))
    f.run()
    for (const route of routes) assert(inventory(f.out).has(`${route}/index.html`))
    assert.equal(inventory(f.out).has('previous.bin'), false)
    assert.deepEqual([...resourceGraph(inventory(f.out), ['connect/index.html'], true)].sort(), ['connect/index.html', 'assets/connect-a.js', 'assets/child-a.js', 'assets/preload-a.js', 'assets/connect-a.css', 'assets/child-a.css', 'HostGrotesk-Variable.ttf', 'hosted/source-pond-v4.png'].sort())
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
for (const [name, mutate, error] of [
  ['different approved collision', f => f.put(f.pub, 'apparent-wordmark.svg', 'different'), /collision/],
  ['different emitted collision', f => f.put(f.pub, 'assets/connect-a.js', 'different'), /collision/],
  ['Connect private path', f => f.put(f.con, 'pitch/index.html', 'private'), /Invalid public path/],
  ['Public private path', f => f.put(f.pub, 'captures/evidence.png', 'private'), /Invalid public path/],
  ['unexpected Connect output', f => f.put(f.con, 'account.json', '{}'), /Unexpected Connect output/],
  ['unexpected Public output', f => f.put(f.pub, 'operator.json', '{}'), /Unexpected Public output/],
  ['unreferenced Connect resource', f => f.put(f.con, 'assets/orphan-a.js', 'unused'), /Unreferenced/],
  ['source map', f => f.put(f.con, 'assets/secret.map', '{}'), /Invalid public path/],
  ['synthetic config', f => f.put(f.con, 'assets/child-a.js', 'const origin="http://127.0.0.1:18809"'), /Synthetic/],
  ['private content', f => f.put(f.con, 'assets/child-a.js', 'const secret="synthetic-csrf"'), /Private/],
  ['Connect marketing graph', f => f.put(f.con, 'assets/child-a.js', 'const css="pond-demo"'), /Wrong resource owner/],
  ['Public API graph', f => f.put(f.pub, 'assets/public-a.js', 'const header="X-CSRF-Token"'), /Wrong resource owner/],
  ['missing import', f => f.put(f.con, 'assets/child-a.js', 'import "./missing-a.js"'), /Missing resource/],
  ['missing preload table', f => f.put(f.con, 'assets/child-a.js', 'const deps=["assets/missing-a.js"]'), /Missing resource/],
  ['missing CSS URL', f => f.put(f.con, 'assets/child-a.css', 'a{background:url(/missing.png)}'), /Missing resource/],
  ['font service', f => f.put(f.con, 'assets/child-a.css', '@import "https://fonts.bunny.net/css";'), /External Connect|Wrong resource/],
  ['changed approved bytes', f => f.put(f.con, approved[0], 'changed'), /Changed approved/],
  ['malformed path', f => f.put(f.con, 'assets/bad%2f-a.js', 'bad'), /Invalid public path/],
  ['symlink', f => symlinkSync(join(f.con, 'assets/child-a.js'), join(f.con, 'assets/link-a.js')), /regular artifact/],
  ['nonregular FIFO', f => assert.equal(spawnSync('mkfifo', [join(f.con, 'fifo')]).status, 0), /regular artifact/],
]) test(`refuse ${name} before changing any output byte or entry`, () => {
  const f = fixture()
  try { const before = snapshot(f.out); mutate(f); assert.throws(() => f.run(), error); assert.deepEqual(snapshot(f.out), before) }
  finally { rmSync(f.root, { recursive: true, force: true }) }
})
test('labelled synthetic composition writes only its separate destination and still refuses wrong origins', () => {
  const f = fixture()
  try {
    const production = snapshot(f.pub)
    f.put(f.con, 'assets/child-a.js', 'const origin="http://127.0.0.1:18809"')
    f.run({ syntheticOrigin: 'http://127.0.0.1:18809' })
    assert.deepEqual(snapshot(f.pub), production)
    assert.throws(() => f.run({ syntheticOrigin: 'http://127.0.0.1:18810' }), /Synthetic/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})
test('reject malformed manifest/resource paths rather than normalizing them into allowed files', () => {
  for (const path of ['../escape', '/root', 'a//b', 'a/./b', 'a\\b', 'a?b', 'a#b', 'a%2fb']) assert.throws(() => safePath(path))
})
