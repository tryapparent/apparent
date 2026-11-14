import assert from 'node:assert/strict'

export const workerName = 'apparent-hosted-beta'
export const accountId = 'a54dcebead3b8ad688f891da0ab54d1f'
export const databaseId = 'a3083552-1d4e-45f9-abf4-02cb7be938f9'
export const bucketName = 'apparent-hosted-beta'
// The reviewed live API deployment predates Wrangler-owned automatic delivery.
const adoptedVersion = 'efbfaf87-be9a-4ff1-b50c-fd998d9fb2cd'

export function strictUpload(previousVersion: string, lastDeployedFrom: unknown): boolean {
  // Wrangler otherwise refuses all API-origin deployments before comparing any
  // settings. Only this immutable adoption baseline may cross that boundary.
  return previousVersion !== adoptedVersion || lastDeployedFrom !== 'api'
}

export interface Binding { name: string; type: string; text?: string; id?: string; bucket_name?: string }
export interface Settings {
  bindings: Binding[]; compatibility_date: string; compatibility_flags: string[]
  logpush?: boolean; tail_consumers?: unknown[]; observability?: { enabled?: boolean }
  limits?: unknown; placement?: unknown; usage_model?: string
}

/** Adoption is pinned to the existing deployment, never a resource initializer. */
export function validateProfile(settings: Settings): void {
  const bindings = new Map(settings.bindings.map(binding => [binding.name, binding]))
  assert.equal(bindings.size, settings.bindings.length, 'Duplicate binding')
  assert.equal(bindings.get('DB')?.type, 'd1')
  assert.equal(bindings.get('DB')?.id, databaseId, 'Unexpected database')
  assert.equal(bindings.get('BUCKET')?.type, 'r2_bucket')
  assert.equal(bindings.get('BUCKET')?.bucket_name, bucketName, 'Unexpected bucket')
  assert.equal(bindings.get('ASSETS')?.type, 'assets')
  for (const [name, text] of Object.entries({
    API_ORIGIN: 'https://app.tryapparent.com/connect',
    SITE_ORIGIN: 'https://app.tryapparent.com', LEGACY_SITE_ORIGIN: 'https://hosted.tryapparent.com',
  })) assert.equal(bindings.get(name)?.text, text, 'Unexpected origin: ' + name)
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENCRYPTION_KEY', 'BETTER_AUTH_SECRET']) {
    assert.equal(bindings.get(name)?.type, 'secret_text', 'Missing existing secret: ' + name)
  }
  assert.ok(settings.bindings.every(binding => ['plain_text', 'secret_text', 'assets', 'd1', 'r2_bucket'].includes(binding.type)), 'Unsupported binding')
  assert.equal(settings.compatibility_date, '2026-11-05')
  assert.deepEqual(settings.compatibility_flags, ['nodejs_compat'])
  assert.equal(settings.logpush, false)
  assert.ok(!settings.observability?.enabled, 'Request logs must remain disabled')
  assert.ok(!settings.tail_consumers?.length, 'Unexpected tail consumer')
  assert.equal(settings.limits, undefined, 'No CPU or paid limit override')
}

export function deploymentConfig(settings: Settings, artifact: string) {
  validateProfile(settings)
  return {
    name: workerName, account_id: accountId, main: artifact + '/worker.js',
    compatibility_date: settings.compatibility_date, compatibility_flags: settings.compatibility_flags,
    // Version upload does not update routes, domains, schedules or subscriptions.
    assets: { directory: artifact + '/dist', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'none' },
    d1_databases: [{ binding: 'DB', database_name: bucketName, database_id: databaseId }],
    r2_buckets: [{ binding: 'BUCKET', bucket_name: bucketName }],
    vars: Object.fromEntries(settings.bindings.filter(binding => binding.type === 'plain_text').map(binding => [binding.name, binding.text])),
    observability: { enabled: false }, upload_source_maps: false,
  }
}

export function sameBindings(before: Binding[], after: Binding[]): void {
  const ordered = (bindings: Binding[]) => [...bindings].sort((a, b) => a.name.localeCompare(b.name))
  assert.deepEqual(ordered(after), ordered(before), 'Runtime bindings changed')
}

export function singleVersion(deployment: { versions: { version_id: string; percentage: number }[] }): string {
  assert.equal(deployment.versions.length, 1, 'Expected one active version')
  assert.equal(deployment.versions[0].percentage, 100, 'Split traffic requires operator review')
  return deployment.versions[0].version_id
}

export function verifyActivationHistory(previous: string, deployed: string, history: { id: string }[]) {
  assert.equal(history[0]?.id, deployed, 'Another publisher owns the active deployment')
  assert.equal(history[1]?.id, previous, 'A competing deployment intervened during activation; operator reconciliation required')
}
