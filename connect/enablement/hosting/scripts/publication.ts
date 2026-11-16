import assert from 'node:assert/strict'
import { setTimeout as pause } from 'node:timers/promises'
import { sameBindings } from './profile.ts'
import type { Binding } from './profile.ts'

export interface WorkerVersion {
  id: string
  annotations?: Record<string, string>
  resources: { bindings: Binding[]; script_runtime: unknown }
}

export async function readBaselineVersion(id: string, read: (id: string) => Promise<WorkerVersion>): Promise<WorkerVersion> {
  const version = await read(id)
  assert.equal(version.id, id, 'Wrong baseline readback')
  return version
}

export function assertStagingOwner(active: string, latest: string, tag?: string): void {
  if (latest === active) return
  // Run 43699705723 stopped before activation after an empty binding readback.
  // Only this reviewed failed stage may be superseded, with its original live
  // baseline still active. All other staged publishers retain their ownership.
  assert.ok(active === '4bc3e3e5-4ab9-4e9c-b2c6-53b8c07fd183' &&
    latest === '51864fbb-02d1-494a-8302-7c581281640b' &&
    tag === 'd81e8eed8a5dfa818cefbbbc32896b5c10d96478', 'A separate version is already staged')
}

export async function readVerifiedVersion(id: string, tag: string, baseline: WorkerVersion,
  read: (id: string) => Promise<WorkerVersion>, wait: (ms: number) => Promise<unknown> = pause): Promise<WorkerVersion> {
  assert.ok(baseline.resources.bindings.length > 0, 'Baseline bindings unavailable')
  for (let attempt = 0; ; attempt++) {
    const version = await read(id)
    assert.equal(version.id, id, 'Wrong version readback')
    assert.equal(version.annotations?.['workers/tag'], tag, 'Wrong staged candidate')
    assert.deepEqual(version.resources.script_runtime, baseline.resources.script_runtime, 'Version runtime configuration changed')
    // Only the observed empty projection is transient. Nonempty drift, wrong
    // identity/runtime and provider failures remain immediate failures.
    if (version.resources.bindings.length === 0 && attempt < 5) {
      await wait(1000 * 2 ** attempt)
      continue
    }
    sameBindings(baseline.resources.bindings, version.resources.bindings)
    return version
  }
}
