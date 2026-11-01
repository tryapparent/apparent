// Explicit approved copies only. Never import any site implementation or marketing assets.
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
export const assetSource = resolve(process.env.CONNECT_ASSET_SOURCE || '../../public/site/public/assets')
const publicDir = new URL('../public/', import.meta.url)
await rm(publicDir, { recursive: true, force: true })
await mkdir(new URL('hosted/', publicDir), { recursive: true })
const assets = [
  ['hosted/source-pond-v4.png', 'hosted/source-pond-v4.png'],
  ['hosted/agent-pond-v4.png', 'hosted/agent-pond-v4.png'],
  ['hosted/agent-reading-v4.png', 'hosted/agent-reading-v4.png'],
  ['fonts/HostGrotesk-Variable.ttf', 'HostGrotesk-Variable.ttf'],
  ['brand/apparent-wordmark.svg', 'apparent-wordmark.svg'],
]
for (const [source, served] of assets) {
  await copyFile(resolve(assetSource, source), new URL(served, publicDir))
}