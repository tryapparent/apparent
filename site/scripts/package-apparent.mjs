// Publish only the Apparent landing page and the assets it actually uses.
// Never copy dist wholesale: it also contains Apparent's update feed, release
// files, agent instructions, and the unlinked feature map.
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const site = join(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(site, "dist")
const out = join(site, "dist-apparent")
const connect = join(site, "../connect/web", process.env.CONNECT_BUILD_DIR ?? "dist")
const html = readFileSync(join(dist, "index.html"), "utf8")
const text = html.replace(/<[^>]*>/g, "")
if (!html.includes("https://app.tryapparent.com/") || !text.includes("Visual feedback gets lost") || !text.includes("We believe work should be")) {
  throw new Error("Refusing to package a stale or unrelated build")
}
if (html.includes("https://apparent.kitlangton.com/") || html.includes("kitlangton/tap")) {
  throw new Error("Refusing to publish upstream download or canonical links")
}
// Validate the entire selected file set before replacing the previous package.
// Never copy either build wholesale, including its unreferenced hashed assets.
const files = new Map()
const visited = new Set()
function add(root, name) {
  const parts = name.split("/")
  if (parts.some(p => !p || p === "." || p === ".." || !/^[\w.-]+$/.test(p))) throw new Error(`Unsafe package path: ${name}`)
  for (let i = 1; i <= parts.length; i++) {
    if (lstatSync(join(root, ...parts.slice(0, i))).isSymbolicLink()) throw new Error(`Symlink in package: ${name}`)
  }
  const path = join(root, name), stat = lstatSync(path)
  if (stat.isDirectory()) {
    for (const child of readdirSync(path).sort()) add(root, `${name}/${child}`)
    return
  }
  if (!stat.isFile()) throw new Error(`Special file in package: ${name}`)
  const bytes = readFileSync(path)
  if (files.has(name)) {
    if (!files.get(name).equals(bytes)) throw new Error(`Asset name collision: ${name}`)
  }
  const key = `${root}:${name}`
  if (visited.has(key)) return
  visited.add(key)
  files.set(name, bytes)
  if (/\.(html|js|css)$/.test(name)) {
    const source = bytes.toString("utf8")
    const references = [...source.matchAll(/["'(](\/assets\/[^"')\s]+)["')]/g)].map(m => m[1].slice(1))
    // Vite may emit relative static/dynamic module imports between chunks.
    references.push(...[...source.matchAll(/(?:from|import)\s*(?:\(\s*)?["']\.\/([^"']+)["']/g)].map(m => `assets/${m[1]}`))
    for (const asset of new Set(references)) {
      if (!/^assets\/[\w.-]+\.(js|css)$/.test(asset)) throw new Error(`Unapproved asset dependency: ${asset}`)
      add(root, asset)
    }
  }
}
for (const name of [
  "index.html", "pond", "team", "feature-demos", "apparent-wordmark.svg", "icon.svg", "HostGrotesk-Variable.ttf",
  "social-preview-v1.png",
  "Apparent-ghost-demo-v4-lilac.mp4", "Apparent-ghost-demo-v4-lilac-poster.jpg",
]) {
  if (!existsSync(join(dist, name))) throw new Error(`Missing required asset: ${name}`)
  add(dist, name)
}
for (const route of ["connect", "connect/device", "hosted", "hosted/device"]) {
  const page = readFileSync(join(connect, route, "index.html"), "utf8")
  if (!page.includes('name="robots" content="noindex, nofollow"') || !page.includes("Checking your account")) throw new Error(`Unsafe Connect SSR: ${route}`)
  add(connect, `${route}/index.html`)
}
for (const name of ["hosted/source-pond-v4.png", "hosted/agent-pond-v4.png", "hosted/agent-reading-v4.png", "HostGrotesk-Variable.ttf", "apparent-wordmark.svg"]) add(connect, name)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
  mkdirSync(dirname(join(out, name)), { recursive: true })
  writeFileSync(join(out, name), bytes)
}
writeFileSync(join(out, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: https://app.tryapparent.com/sitemap.xml\n")
writeFileSync(join(out, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://app.tryapparent.com/</loc></url></urlset>\n')
for (const name of ["appcast.xml", "llms.txt", "skill.md", "og.mp4", "narration.mp3", "narration-iphone.mp3", "releases", "map-tyyxsf5b"]) {
  if (existsSync(join(out, name))) throw new Error(`Unexpected file in public artifact: ${name}`)
}
console.log(`Apparent public artifact: ${out}`)
