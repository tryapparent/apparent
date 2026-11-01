// Explicit approved copies only. Never import any site implementation or marketing assets.
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
export const assetSource = resolve(process.env.CONNECT_ASSET_SOURCE || '../../public/site/public')
const publicDir = new URL('../public/', import.meta.url)
await rm(publicDir, { recursive: true, force: true })
await mkdir(new URL('hosted/', publicDir), { recursive: true })
for (const asset of ['hosted/source-pond-v4.png', 'hosted/agent-pond-v4.png', 'hosted/agent-reading-v4.png', 'HostGrotesk-Variable.ttf', 'apparent-wordmark.svg']) {
  await copyFile(resolve(assetSource, asset), new URL(asset, publicDir))
}