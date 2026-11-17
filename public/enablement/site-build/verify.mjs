// Standalone Public verification and Pages preparation. Connect integration
// stays in stream-connect.yml; this command uses no Connect implementation.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { withRuntimeCaches } from './runtime-caches.ts'

const cwd = fileURLToPath(new URL('../../site/', import.meta.url))
try {
withRuntimeCaches(process.env, runtimeEnv => {
const env = { ...runtimeEnv, APPARENT_PUBLIC_SITE: '1',
  VITE_HOSTED_API_ORIGIN: 'https://hosted.tryapparent.com' }
function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...env, ...extraEnv }, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw Object.assign(new Error(`${command} failed during Public verification`), { exitCode: result.status ?? 1 })
}
run('bun', ['install', '--cwd', '..', '--frozen-lockfile'])
run('node', ['--test', '../enablement/site-build/runtime-caches.test.ts'])
run('npm', ['run', 'build'])
run('node', ['../enablement/site-build/package-apparent.mjs'])
run('bun', ['test', '../enablement/cd/workflow.test.ts'])
const tests = [
  'brand/test-brand-route.ts', 'brand/test-brand-favicon.mjs', 'brand/test-social-preview.mjs', 'browser-proof/test-github-stars.mjs',
  'pages/test-latest-download.mjs', 'pages/test-platform-os.mjs',
  'pages/test-public-homepage.ts', 'browser-proof/test-video-demo.ts',
  'commerce/test-package-text.mjs', 'site-build/test-expected-canonical-packaging.mjs',
  'browser-proof/test-upstream-link-guard.mjs', 'commerce/test-feature-grid.mjs',
  'browser-proof/test-og-stage-redirect.mjs', 'browser-proof/test-og-video-stage-browser.mjs',
]
run('node', ['--test', ...tests.map(path => `../enablement/${path}`)])
run('node', ['--test', '../enablement/artifact/public.test.ts', '../enablement/cd/publish-pages.test.ts',
  '../enablement/pages/test-pages-video.mjs', '../../shared/analytics/config.test.ts'])
run('python3', ['-m', 'unittest', 'discover', '-s', '../../shared/ui/test', '-p', 'test_*.py'])
run('node', ['../../shared/ui/test/appearance.mjs'], { PUBLIC_THEME_ARTIFACT: 'public/site/dist-apparent', THEME_SURFACES: 'public' })
run('npm', ['run', 'build:pages-worker'])
run('node', ['--test', '../enablement/pages/test-pages-video-runtime.ts'], { PAGES_WORKER: 'dist-apparent/_worker.js' })
run('node', ['../enablement/pages/verify-prepared.ts'])
run('node', ['../enablement/cd/analytics-smoke.ts'])
run('node', ['../enablement/artifact/prepare.ts'])
run('node', ['../enablement/pages/prepare-pages-video.mjs'])
})
} catch (error) {
  console.error(error)
  process.exitCode = error.exitCode ?? 1
}
