import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acceptsWorkspace, describe, readRollout, summarize } from './census.ts'

test('pairs real rollout shapes, rejects other workspaces, reports missing results and duplicate rows', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apparent-dev-census-'))
  const row = (type: string, payload: unknown, seconds = 0) => JSON.stringify({ type, payload,
    timestamp: new Date(seconds * 1000).toISOString() })
  const call = { type: 'custom_tool_call', call_id: 'a', name: 'exec',
    input: 'text(await tools.exec_command({cmd:"cargo test"}))' }
  try {
    const file = join(dir, 'fixture.jsonl')
    await writeFile(file, [row('session_meta', { id: 's', cwd: '/fixture' }),
      row('response_item', call, 1), row('response_item', call, 1),
      row('response_item', { type: 'custom_tool_call_output', call_id: 'a', output: [
        { type: 'input_text', text: '{"session_id":123,"output":"still running"}' }] }, 11),
      row('response_item', { ...call, call_id: 'b' }, 12), '{partial'].join('\n'))
    const result = await readRollout(file, cwd => cwd === '/fixture')
    assert.equal(result.calls.length, 2)
    assert.equal(result.calls[0].asynchronous, true)
    assert.equal(result.malformed, 1)
    const report = summarize(result.calls, 0, 20_000)
    assert.equal(report.categories[0].completedToolSeconds, 10)
    assert.equal(report.categories[0].incompleteObservedSeconds, 8)
    assert.equal(report.categories[0].shortCompletedCalls, 0)
    assert.equal((await readRollout(file, () => false)).calls.length, 0)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('clips overlap, deduplicates inherited calls, distinguishes sum from union and ranks frequent short calls', () => {
  const make = (id: string, start: number, end?: number) => ({ id, session: 's', workspace: '/fixture',
    tool: 'exec', ...describe('exec', 'cargo test'), start, end, asynchronous: false })
  const a = make('a', 0, 180_000), b = make('b', 60_000, 240_000)
  const report = summarize([a, a, b, make('outside', 300_000, 400_000)], 30_000, 210_000)
  assert.equal(report.calls, 2)
  assert.equal(report.categories[0].completedToolSeconds, 300)
  assert.equal(report.observedToolUnionSeconds, 180)
  assert.equal(report.categories[0].shortCompletedCalls, 2)
  assert.equal(report.repeatedWrappers[0].calls, 2)
})

test('polls are separate; reports expose fingerprints rather than commands, arguments or output', () => {
  assert.equal(describe('exec', 'tools.write_stdin({session_id:1})').category, 'poll/wait')
  const intent = describe('exec', 'Promise.all([tools.exec_command({cmd:"cargo test private-token"}),tools.exec_command({cmd:"npm test"})])')
  assert.equal(intent.batched, true)
  assert.ok(!JSON.stringify(intent).includes('private-token'))
  assert.equal(describe('exec', 'cargo test /tmp/apparent-dev-a-123/log').fingerprint,
    describe('exec', 'cargo test /tmp/apparent-dev-b-456/log').fingerprint)
})

test('excludes a normalized worktree and its descendants, without excluding similarly named worktrees', () => {
  assert.equal(acceptsWorkspace('/fixture/job', '/fixture', '/fixture/job/'), false)
  assert.equal(acceptsWorkspace('/fixture/job/subdir', '/fixture', '/fixture/job'), false)
  assert.equal(acceptsWorkspace('/fixture/job-other', '/fixture', '/fixture/job'), true)
  assert.equal(acceptsWorkspace('/fixture-other/job', '/fixture'), false)
})

test('old missing results are unknown rather than presumed active for the entire window', () => {
  const call = { id: 'old', session: 's', workspace: '/fixture', tool: 'exec',
    ...describe('exec', 'cargo test'), start: 0, asynchronous: false }
  const report = summarize([call], 10_000, 20_000)
  assert.equal(report.calls, 0)
  assert.equal(report.unmatchedBeforeWindow, 1)
  assert.equal(report.observedToolUnionSeconds, 0)
})

test('correlates asynchronous launch with terminal poll without counting a quick return as a quick build', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apparent-dev-census-'))
  const row = (seconds: number, payload: unknown) => JSON.stringify({ timestamp: new Date(seconds * 1000).toISOString(), type: 'response_item', payload })
  try {
    const file = join(dir, 'fixture.jsonl')
    await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 's', cwd: '/fixture' } }),
      row(1, { type: 'custom_tool_call', call_id: 'launch', name: 'exec', input: 'tools.exec_command({cmd:"cargo test"})' }),
      row(2, { type: 'custom_tool_call_output', call_id: 'launch', output: '{"session_id":123}' }),
      row(10, { type: 'custom_tool_call', call_id: 'poll', name: 'exec', input: 'tools.write_stdin({session_id:123})' }),
      row(11, { type: 'custom_tool_call_output', call_id: 'poll', output: '{"exit_code":0}' }),
    ].join('\n'))
    const result = await readRollout(file, () => true)
    const report = summarize(result.calls, 5_000, 12_000)
    assert.equal(report.correlatedProcesses[0].observedSpanSeconds, 6)
    assert.equal(report.categories.find(g => g.label === 'rust/build'), undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('original provider time, native waits and cross-history call identity survive rollover', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apparent-dev-census-'))
  try {
    const file = join(dir, 'replay.jsonl')
    const item = (type: string, original: number, extra: object) => JSON.stringify({type: 'response_item',
      timestamp: new Date(500_000).toISOString(), payload: {type, call_id: 'stable',
        internal_chat_message_metadata_passthrough: {create_time: original}, ...extra}})
    await writeFile(file, [JSON.stringify({type: 'session_meta', payload: {id: 'new-history', cwd: '/fixture'}}),
      'null', item('custom_tool_call', 1, {name: 'wait_agent', input: '{}'}),
      item('custom_tool_call_output', 4, {output: [{type: 'input_text', text: 'complete'}]})].join('\n'))
    const result = await readRollout(file, () => true)
    assert.equal(result.malformed, 1)
    assert.equal(result.calls[0].start, 1000)
    assert.equal(result.calls[0].end, 4000)
    assert.equal(result.calls[0].category, 'poll/wait')
    const report = summarize([...result.calls, {...result.calls[0], session: 'old-history'}], 0, 10_000)
    assert.equal(report.calls, 1)
    assert.deepEqual(report.categories[0].arithmetic, {count: 1, meanSeconds: 3, totalSeconds: 3})
    assert.equal(summarize(result.calls, 400_000, 600_000).calls, 0, 'reserialized old activity is not new work')
  } finally { await rm(dir, {recursive: true, force: true}) }
})

test('frequency arithmetic counts overlapping short calls without pretending the sum is wall time', () => {
  const calls = [0, 1, 2].map(i => ({id: String(i), session: 's', workspace: '/fixture', tool: 'exec',
    ...describe('exec', 'cargo test'), start: 1000 * i, end: 1000 * i + 1500, asynchronous: false}))
  const report = summarize(calls, 0, 10_000)
  assert.deepEqual(report.categories[0].arithmetic, {count: 3, meanSeconds: 1.5, totalSeconds: 4.5})
  assert.equal(report.observedToolUnionSeconds, 3.5)
  assert.equal(report.repeatedWrappers[0].arithmetic.totalSeconds, 4.5)
})

test('ranking uses exact totals rather than rounded seconds or call counts', () => {
  const make = (id: string, category: string, end: number) => ({id, session: 's', workspace: '/fixture', tool: 'exec',
    fingerprint: id, category, start: 0, end, asynchronous: false, batched: false});
  const report = summarize([make('a', 'frequent', 100), make('b', 'frequent', 100), make('c', 'higher-total', 490)], 0, 1000);
  assert.equal(report.categories[0].label, 'higher-total');
  assert.equal(report.categories[0].arithmetic.totalSeconds, .49);
})

test('complementary rollover records preserve recovered process completion in either file order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apparent-dev-census-'));
  try {
    const meta = (id: string) => JSON.stringify({type: 'session_meta', payload: {id, cwd: '/fixture'}});
    const row = (t: number, payload: object) => JSON.stringify({type: 'response_item', timestamp: new Date(t).toISOString(), payload});
    const launch = [row(1000, {type: 'custom_tool_call', call_id: 'stable', name: 'exec', input: 'tools.exec_command({cmd:"cargo test"})'}),
      row(2000, {type: 'custom_tool_call_output', call_id: 'stable', output: [{type: 'input_text', text: '{"session_id":123}'}]})];
    const first = join(dir, 'first.jsonl'), second = join(dir, 'second.jsonl');
    await writeFile(first, [meta('first'), ...launch].join('\n'));
    await writeFile(second, [meta('second'), ...launch,
      row(10_000, {type: 'custom_tool_call', call_id: 'poll', name: 'exec', input: 'tools.write_stdin({session_id:123})'}),
      row(11_000, {type: 'custom_tool_call_output', call_id: 'poll', output: '{"exit_code":0}'})].join('\n'));
    const a = await readRollout(first, () => true), b = await readRollout(second, () => true);
    for (const calls of [[...a.calls, ...b.calls], [...b.calls, ...a.calls]]) {
      const report = summarize(calls, 0, 12_000);
      assert.equal(report.correlatedProcesses.length, 1);
      assert.equal(report.correlatedProcesses[0].observedSpanSeconds, 10);
    }
  } finally {await rm(dir, {recursive: true, force: true});}
})

for (const [name, prelude, expected, mixed] of [
  ['direct launch', '', ['verification/push'], false],
  ['private job', 'set -e\njob=$(mktemp -d /tmp/apparent-dev-example-XXXXXX)\nexport TMPDIR="$job"\n',
    ['file/artifact management', 'verification/push'], false],
  ['main pin', 'set -e\ngit fetch origin main\ntest "$(git rev-parse origin/main)" = "$(git rev-parse HEAD^)"\ngit log -1 HEAD\n',
    ['Git inspection', 'verification/push'], false],
  ['focused test and clean-tree guard', 'set -e\nnode --test example.test.ts\ngit add example.ts\ngit commit -m example\ntest -z "$(git status --porcelain)"\n',
    ['Git inspection', 'Git integration/editing', 'JavaScript/package build/test', 'verification/push'], true],
] as const) {
  test(`hook-backed push rollout with ${name} preserves exact process and wait clocks`, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apparent-dev-census-'))
    const file = join(dir, 'push.jsonl')
    const row = (ms: number, type: string, call_id: string, fields: object) =>
      JSON.stringify({ type: 'response_item', timestamp: new Date(ms).toISOString(), payload: { type, call_id, ...fields } })
    const cmd = prelude + (name === 'private job' ? 'exec ' : '') +
      'node --experimental-strip-types enablement/local-tests/execution/push.ts --jobs 2 -- origin HEAD > "/tmp/example/log" 2>&1'
    const receipt = (status: object) => ['Script completed\nWall time 1.0 seconds\nOutput:\n',
      JSON.stringify({chunk_id: 'fixture', wall_time_seconds: 1, original_token_count: 0, output: '', ...status})]
      .map(text => ({type: 'input_text', text}))
    try {
      await writeFile(file, [
        JSON.stringify({ type: 'session_meta', payload: { id: 's', cwd: '/fixture' } }),
        row(1000, 'custom_tool_call', 'push', { name: 'exec', input: 'text(await tools.exec_command({cmd:`' + cmd + '`,yield_time_ms:1000}));' }),
        row(2000, 'custom_tool_call_output', 'push', { output: receipt({session_id: 123}) }),
        row(3000, 'custom_tool_call', 'poll', { name: 'exec', input: 'text(await tools.write_stdin({session_id:123}));' }),
        row(4000, 'custom_tool_call_output', 'poll', { output: 'Script running with cell ID cell:1\nWall time 1.0 seconds\nOutput:\n' }),
        row(4000, 'function_call', 'cell', { namespace: 'functions', name: 'wait', arguments: '{"cell_id":"cell:1"}' }),
        row(6000, 'function_call_output', 'cell', { output: receipt({exit_code: 0}) }),
        row(8000, 'custom_tool_call', 'terminal', { name: 'exec', input: 'text(await tools.write_stdin({session_id:123}));' }),
        row(11000, 'custom_tool_call_output', 'terminal', { output: 'Process exited with code 0' }),
      ].join('\n'))
      const { calls } = await readRollout(file, () => true)
      const report = summarize(calls, 0, 12000)
      assert.deepEqual(calls.map(c => [c.id, c.start, c.end, c.processObservedEnd]), [
        ['push', 1000, 2000, 6000], ['poll', 3000, 4000, undefined], ['cell', 4000, 6000, undefined],
        ['terminal', 8000, 11000, undefined],
      ])
      assert.equal(report.calls, 4)
      assert.equal(report.observedToolUnionSeconds, 7)
      assert.deepEqual(calls[0].operations, expected)
      for (const wait of calls.slice(1)) assert.deepEqual(wait.waitedOperations, expected)
      const { envelopes, processes } = report.actionRanking
      const label = prelude ? 'verification/push with preparation' : 'verification/push'
      const waits = envelopes.ranked.find(g => g.label === (mixed ? 'process wait' : 'waiting/status for ' + label))
      assert.deepEqual([waits?.count, waits?.meanSeconds, waits?.totalSeconds, waits?.unresolved], [3, 2, 6, mixed])
      assert.equal(envelopes.unresolvedSeconds, mixed ? 7 : 0)
      assert.equal(processes.ranked.length, 1)
      const process = processes.ranked[0]
      assert.equal(process.label, mixed ? expected.join(' + ') : label)
      assert.deepEqual([process.count, process.meanSeconds, process.totalSeconds, process.unresolved], [1, 5, 5, mixed])
      assert.equal(processes.winnerEstablished, !mixed)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
}
