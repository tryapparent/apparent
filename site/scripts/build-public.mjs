// Build independently owned products, then compose only their public contract.
// Dependency installation is explicit: site Bun 1.3.10; Connect Bun 1.4.4.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const site = fileURLToPath(new URL('../', import.meta.url))
const connect = fileURLToPath(new URL('../../connect/web/', import.meta.url))
for (const [cwd, command, args] of [
  [site, 'npm', ['run', 'build']],
  [connect, 'npm', ['run', 'build']],
  [site, process.execPath, ['scripts/package-apparent.mjs']],
]) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, APPARENT_PUBLIC_SITE: '1' } })
  if (result.status !== 0) throw new Error(`Public build failed in ${cwd}: ${result.error || result.status}`)
}
