// Explicit approved copies only. Never import any site implementation or marketing assets.
import { copyFile, mkdir, rm } from 'node:fs/promises'
const publicDir = new URL('../public/', import.meta.url)
await rm(publicDir, { recursive: true, force: true })
await mkdir(new URL('hosted/', publicDir), { recursive: true })
for (const asset of ['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png', 'hosted/agent-reading-v4.png', 'HostGrotesk-Variable.ttf', 'apparent-wordmark.svg']) {
  await copyFile(new URL(`../../../site/public/${asset}`, import.meta.url), new URL(asset, publicDir))
}
