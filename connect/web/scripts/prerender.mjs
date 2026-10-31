import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
const dist = new URL(`../${process.env.CONNECT_BUILD_DIR ?? 'dist'}/`, import.meta.url)
const { render } = await import('../dist-ssr/entry-server.js')
const template = await readFile(new URL('index.html', dist), 'utf8')
if (!template.includes('<!--app-->')) throw new Error('Connect template is missing its app slot')
for (const [route, device] of [['connect', false], ['connect/device', true], ['hosted', false], ['hosted/device', true]]) {
  const dir = new URL(`${route}/`, dist)
  await mkdir(dir, { recursive: true })
  await writeFile(new URL('index.html', dir), template.replace('<!--app-->', render(device)).replace('<title>Connect — Apparent</title>', `<title>Connect${device ? ' a device' : ''} — Apparent</title>`))
}
// Deployment composition must not replace the marketing root or admit new routes.
await rm(new URL('index.html', dist))
await rm(new URL('../dist-ssr/', import.meta.url), { recursive: true, force: true })
console.log('Connect route-only artifact: dist/{connect,hosted}[/device]/index.html')
