import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve, posix } from 'node:path'
import test from 'node:test'
const root = resolve(process.env.CONNECT_ARTIFACT || 'dist')
const routes = ['connect', 'connect/device', 'connect/shares', 'hosted', 'hosted/device', 'hosted/shares']
const approved = ['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png', 'hosted/agent-reading-v4.png', 'HostGrotesk-Variable.ttf', 'apparent-wordmark.svg']
test('exact emitted route/resource closure excludes private and backend output', async () => {
  async function files(dir = '') {
    const result = []
    for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
      const path = posix.join(dir, entry.name)
      if (entry.isDirectory()) result.push(...await files(path))
      else { assert(entry.isFile(), `unexpected non-file ${path}`); result.push(path) }
    }
    return result
  }
  const all = await files()
  const visited = new Set(approved)
  const pending = routes.map(route => `${route}/index.html`)
  while (pending.length) {
    const file = pending.pop()
    if (visited.has(file)) continue
    visited.add(file)
    const text = await readFile(resolve(root, file), 'utf8')
    assert.doesNotMatch(text, /sourceMappingURL|verified@example|synthetic-csrf|must-not-render|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|client_secret|pitch-deck|contact-sheet\.png|recording\.(?:mp4|mov)/)
    const pattern = file.endsWith('.html') ? /(?:src|href)=["']([^"']+)["']/g
      : file.endsWith('.css') ? /url\(["']?([^\s)'"?]+)/g
        : /(?:from\s*|import\s*\(|import\s*)["']([^"']+)["']/g
    const refs = [...text.matchAll(pattern)]
    for (const match of refs) {
      const ref = match[1] || match[2] || match[3]
      if (ref === '/' || /^(?:https?:|data:|#)/.test(ref)) continue
      let target = ref.startsWith('/') ? ref.slice(1) : posix.normalize(posix.join(posix.dirname(file), ref))
      if (routes.some(route => target === route || target === `${route}/`)) target = `${target.replace(/\/$/, '')}/index.html`
      assert(all.includes(target), `${file} references missing resource ${target}`)
      if (/\.(?:js|css)$/.test(target)) pending.push(target)
      else visited.add(target)
    }
  }
  assert.deepEqual([...visited].sort(), all.sort(), 'no unreferenced output, maps, private routes or backend files')
  for (const file of all) assert(approved.includes(file) || routes.some(route => file === `${route}/index.html`) || /^assets\/[^/]+-[\w-]+\.(js|css)$/.test(file), file)
})
