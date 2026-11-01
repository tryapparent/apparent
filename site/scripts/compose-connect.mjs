// Artifact-only seam. No browser source or backend is imported by Public.
import { lstatSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, dirname, posix, resolve } from 'node:path'
import { parse } from 'parse5'
import { fileURLToPath } from 'node:url'

export const routes = ['connect', 'connect/device', 'connect/shares', 'hosted', 'hosted/device', 'hosted/shares']
export const approved = ['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png', 'hosted/agent-reading-v4.png', 'HostGrotesk-Variable.ttf', 'apparent-wordmark.svg']
const privatePath = /(?:^|\/)(?:\.env[^/]*|.*\.map|pitch[^/]*|captures?|contact-sheet\.png|recording\.(?:mp4|mov)|deployment\.json|node_modules|functions|backend)(?:\/|$)/i
const sensitive = /sourceMappingURL|verified@example|synthetic-csrf|must-not-render|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|client_secret/
export function safePath(path) {
  if (!path || path.startsWith('/') || /[\\%?#\x00-\x20]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') || privatePath.test(path)) throw Error(`Invalid public path: ${path}`)
  return path
}
export function inventory(root) {
  const result = new Map()
  function walk(path = '') {
    const full = join(root, path), stat = lstatSync(full)
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error(`Only regular artifact files permitted: ${path}`)
    if (stat.isDirectory()) for (const name of readdirSync(full)) walk(path ? `${path}/${name}` : name)
    else result.set(safePath(path), readFileSync(full))
  }
  walk(); return result
}
export function mergeFiles(left, right) {
  const result = new Map(left)
  for (const [path, bytes] of right) {
    safePath(path)
    if (result.has(path) && !result.get(path).equals(bytes)) throw Error(`Differing artifact collision: ${path}`)
    result.set(path, bytes)
  }
  return result
}
// Include HTML modulepreloads, emitted static/dynamic imports and Vite preload
// tables (quoted asset filenames), CSS imports and URLs. Navigation is not a fetch.
export function resourceGraph(files, starts, connect = false) {
  const seen = new Set(), pending = [...starts]
  function reference(file, ref) {
    if (/^(?:data:|#)/.test(ref)) return
    if (/^(?:https?:)?\/\//.test(ref)) {
      if (connect) throw Error(`External Connect resource: ${ref}`)
      return
    }
    if (/[\\\x00-\x20%]/.test(ref)) throw Error(`Malformed resource: ${ref}`)
    const clean = ref.split(/[?#]/)[0]
    const target = clean.startsWith('/') ? clean.slice(1) : clean.startsWith('assets/') && file.endsWith('.js') ? clean : posix.normalize(posix.join(posix.dirname(file), clean))
    safePath(target)
    if (!files.has(target)) throw Error(`Missing resource: ${file} -> ${target}`)
    pending.push(target)
  }
  while (pending.length) {
    const file = pending.pop()
    if (seen.has(file)) continue
    if (!files.has(file)) throw Error(`Missing document: ${file}`)
    seen.add(file)
    if (!/\.(?:html|js|css)$/.test(file)) continue
    const text = files.get(file).toString('utf8')
    if (sensitive.test(text)) throw Error(`Private content in artifact: ${file}`)
    if (connect ? /Visual feedback gets lost|pond-hero|pond-demo|pond-team|fonts\.bunny\.net/.test(text) : /X-CSRF-Token|hosted-panel|hosted-page/.test(text)) throw Error(`Wrong resource owner: ${file}`)
    if (file.endsWith('.html')) {
      function visit(node) {
        const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]))
        if (attrs.src) reference(file, attrs.src)
        if (attrs.poster) reference(file, attrs.poster)
        if (node.tagName === 'link' && /(?:stylesheet|modulepreload|preload|icon)/.test(attrs.rel || '') && attrs.href) reference(file, attrs.href)
        for (const child of node.childNodes || []) visit(child)
      }
      visit(parse(text))
    } else if (file.endsWith('.css')) {
      for (const m of text.matchAll(/url\(\s*["']?([^\s)'"\\]+)["']?\s*\)|@import\s*["']([^"']+)["']/g)) reference(file, m[1] || m[2])
    } else {
      for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']|["']((?:\.?\.?\/|\/)?assets\/[^"'\s]+\.(?:js|css)|\.\/[^"'\s]+\.(?:js|css))["']/g)) reference(file, m[1] || m[2])
    }
  }
  return seen
}
export function validateConnect(files, canonical, { syntheticOrigin } = {}) {
  const docs = routes.map(route => `${route}/index.html`)
  for (const [path, bytes] of files) {
    if (!(docs.includes(path) || approved.includes(path) || /^assets\/[^/]+-[\w-]+\.(?:js|css)$/.test(path))) throw Error(`Unexpected Connect output: ${path}`)
    if (/\.(?:html|js|css)$/.test(path)) {
      const text = bytes.toString('utf8')
      if (sensitive.test(text)) throw Error(`Private Connect content: ${path}`)
      // Match actual URL values, not the API validator's bare loopback host names.
      for (const m of text.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/g)) if (!syntheticOrigin || m[0] !== syntheticOrigin) throw Error(`Synthetic Connect configuration: ${path}`)
    }
  }
  if (syntheticOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(syntheticOrigin)) throw Error('Expected a labelled synthetic loopback origin')
  const js = [...files].filter(([p]) => p.endsWith('.js')).map(([, b]) => b.toString()).join('\n')
  if (!js.includes(syntheticOrigin || 'https://hosted.tryapparent.com')) throw Error('Missing expected Connect API origin')
  for (const path of docs) {
    const html = files.get(path)?.toString() || ''
    if (!/Checking your account/.test(html) || !/name="robots" content="noindex, nofollow"/.test(html) || !/http-equiv="Cache-Control" content="no-store"/.test(html) || !/name="referrer" content="no-referrer"/.test(html) || /csrfToken|accessToken|application\/ld\+json|rel="canonical"/.test(html)) throw Error(`Invalid Connect loading document: ${path}`)
  }
  for (const path of approved) if (!files.has(path) || !files.get(path).equals(canonical.get(path))) throw Error(`Changed approved asset: ${path}`)
  const graph = resourceGraph(files, docs, true)
  for (const path of approved) graph.add(path)
  if (graph.size !== files.size) throw Error('Unreferenced Connect output')
}
export function writeArtifact(out, files, inputs = []) {
  for (const input of inputs) if (resolve(out) === resolve(input) || resolve(input).startsWith(resolve(out) + '/') || resolve(out).startsWith(resolve(input) + '/')) throw Error('Output must not overlap an input')
  // Existing output is not an input, but never follow a link while replacing it.
  try { if (lstatSync(out).isSymbolicLink()) throw Error('Output is a symlink') } catch (error) { if (error.code !== 'ENOENT') throw error }
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  for (const [path, bytes] of files) { mkdirSync(dirname(join(out, path)), { recursive: true }); writeFileSync(join(out, path), bytes) }
}

export function validatePublic(files, canonical) {
  for (const [path, bytes] of files) {
    if (!/^(?:index\.html|robots\.txt|sitemap\.xml|apparent-wordmark\.svg|icon\.svg|HostGrotesk-Variable\.ttf|social-preview-v1\.png|Apparent-ghost-demo-v4-lilac(?:-poster\.jpg|\.mp4))$/.test(path)
      && !/^assets\/[^/]+-[\w-]+\.(?:js|css)$/.test(path)
      && !(/^(?:pond|team|feature-demos)\/.+/.test(path) && canonical.has(path))) throw Error(`Unexpected Public output: ${path}`)
    if (/\.(?:html|js|css|svg)$/.test(path) && sensitive.test(bytes.toString())) throw Error(`Private Public content: ${path}`)
  }
  resourceGraph(files, ['index.html'])
}
export function composeArtifacts(publicRoot, connectRoot, canonicalRoot, out, options = {}) {
  const publicFiles = inventory(publicRoot), connectFiles = inventory(connectRoot), canonical = inventory(canonicalRoot)
  validatePublic(publicFiles, canonical)
  validateConnect(connectFiles, canonical, options)
  const composed = mergeFiles(publicFiles, connectFiles)
  // Both complete inventories, resource graphs, approved bytes and collisions
  // have been checked before replacing any file in the destination.
  writeArtifact(out, composed, [connectRoot, canonicalRoot])
  return composed
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const site = resolve(import.meta.dirname, '..'), syntheticOrigin = process.env.COMPOSE_SYNTHETIC_ORIGIN
  composeArtifacts(process.env.COMPOSE_PUBLIC_INPUT || join(site, 'dist-apparent'), join(site, '../connect/web', syntheticOrigin ? 'dist-test' : 'dist'), join(site, 'public'), join(site, syntheticOrigin ? 'dist/synthetic-composition' : 'dist-apparent'), { syntheticOrigin })
  console.log(`Composed independent Public + Connect artifacts (${syntheticOrigin ? 'synthetic only' : 'production origin'})`)
}
