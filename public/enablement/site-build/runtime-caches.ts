import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Only defaults belong to verification. Explicit caller cache/config settings
// remain authoritative, and only our private directory may be removed.
export function withRuntimeCaches<T>(env: NodeJS.ProcessEnv, verify: (env: NodeJS.ProcessEnv) => T): T {
  const root = mkdtempSync(join(env.TMPDIR || tmpdir(), 'apparent-dev-public-runtime-'))
  try {
    return verify({
      ...env,
      MINIFLARE_CACHE_DIR: env.MINIFLARE_CACHE_DIR ?? join(root, 'miniflare'),
      WRANGLER_CACHE_DIR: env.WRANGLER_CACHE_DIR ?? join(root, 'wrangler'),
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
