import assert from 'node:assert/strict'
import test from 'node:test'
import { assertStagingOwner, readBaselineVersion, readVerifiedVersion } from '../scripts/publication.ts'
import type { WorkerVersion } from '../scripts/publication.ts'

const active = '4bc3e3e5-4ab9-4e9c-b2c6-53b8c07fd183'
const abandoned = '51864fbb-02d1-494a-8302-7c581281640b'
const abandonedTag = 'd81e8eed8a5dfa818cefbbbc32896b5c10d96478'
const baseline: WorkerVersion = { id: active, resources: {
  bindings: [{ name: 'DB', type: 'd1', id: 'synthetic-db' }, { name: 'TOKEN', type: 'secret_text' }],
  script_runtime: { compatibility_date: '2026-11-05', compatibility_flags: ['nodejs_compat'] },
} }
const candidate = (): WorkerVersion => ({ ...structuredClone(baseline), id: 'candidate', annotations: { 'workers/tag': 'tested-sha' } })

test('the active baseline read must return the exact version serving traffic', async () => {
  const result = await readBaselineVersion(active, async id => {
    assert.equal(id, active)
    return structuredClone(baseline)
  })
  assert.equal(result.id, active)
  await assert.rejects(readBaselineVersion(active, async () => ({ ...structuredClone(baseline), id: 'other-version' })), /Wrong baseline readback/)
})

test('only the reviewed failed staging tuple may coexist with the unchanged active version', () => {
  assertStagingOwner(active, active)
  assertStagingOwner(active, abandoned, abandonedTag)
  assertStagingOwner(active, 'stale-stage', 'ancestor-tag', tag => tag === 'ancestor-tag')
  assert.throws(() => assertStagingOwner(active, 'stale-stage', 'other-tag', () => false), /separate version/)
  for (const [live, staged, tag] of [
    ['another-active', abandoned, abandonedTag], [active, 'another-stage', abandonedTag],
    [active, abandoned, 'another-tag'], [active, abandoned, undefined],
  ]) assert.throws(() => assertStagingOwner(live!, staged!, tag), /separate version/)
})

test('empty binding metadata is reread for the same immutable candidate before acceptance', async () => {
  let reads = 0
  const delays: number[] = []
  const result = await readVerifiedVersion('candidate', 'tested-sha', baseline, async id => {
    assert.equal(id, 'candidate')
    const version = candidate()
    if (++reads < 3) version.resources.bindings = []
    return version
  }, async ms => { delays.push(ms) })
  assert.equal(reads, 3)
  assert.deepEqual(delays, [1000, 2000])
  assert.deepEqual(result.resources.bindings, baseline.resources.bindings)
})

test('empty binding metadata has a finite retry budget and never becomes acceptance', async () => {
  let reads = 0
  const delays: number[] = []
  await assert.rejects(readVerifiedVersion('candidate', 'tested-sha', baseline, async () => {
    reads++
    const version = candidate(); version.resources.bindings = []; return version
  }, async ms => { delays.push(ms) }), /bindings/)
  assert.equal(reads, 6)
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000])
})

test('nonempty binding drift, runtime drift and wrong identity fail immediately', async () => {
  for (const mutate of [
    (v: WorkerVersion) => { v.resources.bindings[0]!.id = 'other-db' },
    (v: WorkerVersion) => { v.resources.bindings.pop() },
    (v: WorkerVersion) => { v.resources.script_runtime = { compatibility_date: 'other' } },
    (v: WorkerVersion) => { v.id = 'other-version' },
    (v: WorkerVersion) => { v.annotations!['workers/tag'] = 'other-sha' },
  ]) {
    let reads = 0
    await assert.rejects(readVerifiedVersion('candidate', 'tested-sha', baseline, async () => {
      reads++; const version = candidate(); mutate(version); return version
    }, async () => { assert.fail('Drift must not retry') }))
    assert.equal(reads, 1)
  }
})

test('provider errors remain failures without retrying or creating a version', async () => {
  let reads = 0
  await assert.rejects(readVerifiedVersion('candidate', 'tested-sha', baseline, async () => {
    reads++; throw Error('provider unavailable')
  }, async () => { assert.fail('Provider error must not retry') }), /provider unavailable/)
  assert.equal(reads, 1)
})

test('empty metadata cannot conceal later binding drift or an unavailable baseline', async () => {
  let reads = 0
  await assert.rejects(readVerifiedVersion('candidate', 'tested-sha', baseline, async () => {
    const version = candidate()
    if (++reads === 1) version.resources.bindings = []
    else version.resources.bindings[0]!.id = 'other-db'
    return version
  }, async () => {}), /bindings/)
  assert.equal(reads, 2)
  const unavailable = structuredClone(baseline); unavailable.resources.bindings = []
  await assert.rejects(readVerifiedVersion('candidate', 'tested-sha', unavailable,
    async () => { assert.fail('An unavailable baseline must fail before candidate reads') }), /Baseline bindings unavailable/)
})
