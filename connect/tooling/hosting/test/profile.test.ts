import assert from 'node:assert/strict'
import test from 'node:test'
import { accountId, databaseId, bucketName, workerName, deploymentConfig, validateProfile, sameBindings, singleVersion, verifyActivationHistory } from '../scripts/profile.ts'
import type { Settings } from '../scripts/profile.ts'

function profile(): Settings {
  return { compatibility_date: '2026-11-05', compatibility_flags: ['nodejs_compat'], logpush: false, bindings: [
    { name: 'DB', type: 'd1', id: databaseId }, { name: 'BUCKET', type: 'r2_bucket', bucket_name: bucketName }, { name: 'ASSETS', type: 'assets' },
    ...Object.entries({ API_ORIGIN: 'https://app.tryapparent.com/connect', SITE_ORIGIN: 'https://app.tryapparent.com', LEGACY_SITE_ORIGIN: 'https://hosted.tryapparent.com', POSTHOG_ENABLED: 'false' }).map(([name, text]) => ({ name, type: 'plain_text', text })),
    ...['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'BETTER_AUTH_SECRET'].map(name => ({ name, type: 'secret_text' })),
  ] }
}
test('deployment targets only the adopted Worker and preserves private provider credentials', () => {
  const settings = profile(), config = deploymentConfig(settings, '/synthetic/artifact')
  assert.equal(config.account_id, accountId)
  assert.equal(config.name, workerName)
  assert.equal(config.vars.API_ORIGIN, 'https://app.tryapparent.com/connect')
  for (const key of ['routes', 'triggers', 'limits', 'migrations', 'workers_dev', 'secrets']) assert.ok(!(key in config))
  assert.ok(!JSON.stringify(config).includes('SECRET'))
  assert.equal(config.assets.run_worker_first, true)
  assert.equal(config.observability.enabled, false)
  sameBindings(settings.bindings, [...settings.bindings].reverse())
  const changed = structuredClone(settings.bindings); changed.find(binding => binding.name === 'POSTHOG_ENABLED')!.text = 'true'
  assert.throws(() => sameBindings(settings.bindings, changed), /Runtime bindings changed/)
})
test('unexpected resources, origins, secret profiles and paid/log settings fail before upload', () => {
  for (const mutate of [
    (p: Settings) => { p.bindings.find(b => b.name === 'DB')!.id = 'unapproved' },
    (p: Settings) => { p.bindings.find(b => b.name === 'BUCKET')!.bucket_name = 'public-bucket' },
    (p: Settings) => { p.bindings.find(b => b.name === 'API_ORIGIN')!.text = 'https://hosted.tryapparent.com' },
    (p: Settings) => { p.bindings.find(b => b.name === 'GOOGLE_CLIENT_ID')!.type = 'plain_text' },
    (p: Settings) => { p.bindings.push({ name: 'QUEUE', type: 'queue' }) },
    (p: Settings) => { p.logpush = true }, (p: Settings) => { p.observability = { enabled: true } },
    (p: Settings) => { p.limits = { cpu_ms: 30000 } },
  ]) { const p = profile(); mutate(p); assert.throws(() => validateProfile(p)) }
})
test('split or missing active versions cannot be replaced automatically', () => {
  assert.equal(singleVersion({ versions: [{ version_id: 'old', percentage: 100 }] }), 'old')
  for (const versions of [[], [{ version_id: 'old', percentage: 50 }], [{ version_id: 'old', percentage: 50 }, { version_id: 'other', percentage: 50 }]]) assert.throws(() => singleVersion({ versions }))
})
test('activation readback detects competing publishers in either ordering', () => {
  verifyActivationHistory('previous', 'ours', [{ id: 'ours' }, { id: 'previous' }])
  assert.throws(() => verifyActivationHistory('previous', 'ours', [{ id: 'other' }, { id: 'ours' }]), /Another publisher/)
  assert.throws(() => verifyActivationHistory('previous', 'ours', [{ id: 'ours' }, { id: 'other' }, { id: 'previous' }]), /competing deployment/)
})
