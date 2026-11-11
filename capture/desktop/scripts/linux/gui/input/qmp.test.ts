import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Qmp, sendPlan, qualify, validatePlan, type Plan} from './qmp.ts';

const plan: Plan = {profile: 'mouse', actions: [
  {kind: 'button', down: true}, {kind: 'relative', x: 20, y: 10}, {kind: 'button', down: false},
  {kind: 'key', code: 'shift', down: true}, {kind: 'key', code: 'shift', down: false}]};
async function fixture(run: (path: string, commands: any[]) => Promise<void>, breakMovement = false) {
  const dir = mkdtempSync(join(tmpdir(), 'qmp-'));
  const path = join(dir, 'q.sock');
  const commands: any[] = [];
  let selected = 0;
  const sockets = new Set<any>();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.write('{"QMP":'); setTimeout(() => socket.write('{}}\n'), 5);
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const command = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        commands.push(command);
        if (command.execute === 'human-monitor-command') selected = Number(command.arguments['command-line'].split(' ')[1]);
        const mice = [{index: 0, name: 'other', absolute: false, current: selected === 0},
          {index: 1, name: 'QEMU USB Mouse', absolute: false, current: selected === 1}];
        const broken = breakMovement && command.arguments.events?.some((e: any) => e.type === 'rel');
        socket.write(JSON.stringify({event: 'ASYNC'}) + '\n');
        socket.write(JSON.stringify(broken ? {id: command.id, error: {desc: 'injected movement failure'}} :
          {id: command.id, return: command.execute === 'query-mice' ? mice : {}}) + '\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(path, resolve));
  try { await run(path, commands); }
  finally { for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, {recursive: true}); }
}
test('fragmented greeting, asynchronous events, relative stroke and restoration', async () => {
  await fixture(async (path, commands) => {
    assert.equal((await sendPlan(new Qmp(path), plan)).product, 'unrun');
    assert.equal(commands.at(-2).arguments['command-line'], 'mouse_set 0');
    assert.equal(commands.filter(c => c.execute === 'input-send-event').length, 5);
  });
});
test('a failed held stroke releases the button and restores prior mouse', async () => {
  await fixture(async (path, commands) => {
    await assert.rejects(sendPlan(new Qmp(path), plan), /injected movement failure/);
    assert.deepEqual(commands.at(-3).arguments.events, [{type: 'btn', data: {down: false, button: 'left'}}]);
    assert.equal(commands.at(-2).arguments['command-line'], 'mouse_set 0');
  }, true);
});
test('timeout while Shift is held releases it within the fixed deadline', async () => {
  await fixture(async (path, commands) => {
    const start = Date.now();
    await assert.rejects(sendPlan(new Qmp(path), {profile: 'mouse', actions: [
      {kind: 'key', code: 'shift', down: true}, {kind: 'wait', ms: 2000}, {kind: 'key', code: 'shift', down: false}]}, 1000), /deadline/);
    assert.ok(Date.now() - start < 1500);
    assert.deepEqual(commands.at(-3).arguments.events, [{type: 'key', data: {down: false, key: {type: 'qcode', data: 'shift'}}}]);
  });
});
test('refuses mixed devices, held keys, numeric keysym names and off-screen coordinates before connecting', () => {
  for (const value of [
    {...plan, actions: [{kind: 'absolute', x: 1, y: 1, width: 100, height: 100}]},
    {...plan, actions: [{kind: 'key', code: 'shift', down: true}]},
    {...plan, actions: [{kind: 'key', code: '201', down: true}]},
    {profile: 'tablet', actions: [{kind: 'absolute', x: 100, y: 1, width: 100, height: 100}]},
  ]) assert.throws(() => validatePlan(value));
});
function observed() {
  return [
    {type: 'pointerdown', pointerId: 1, button: 0, buttons: 1},
    {type: 'pointermove', pointerId: 1, buttons: 1, clientX: 10, clientY: 10},
    {type: 'pointermove', pointerId: 1, buttons: 1, clientX: 20, clientY: 20},
    {type: 'pointerup', pointerId: 1, button: 0, buttons: 0},
    {type: 'keydown', key: 'Shift', code: 'ShiftLeft', shiftKey: true},
    {type: 'click', shiftKey: true, buttons: 0},
    {type: 'keyup', key: 'CapsLock', code: 'ShiftLeft', shiftKey: true},
    {type: 'pointermove', pointerId: 1, buttons: 0, shiftKey: false, clientX: 30, clientY: 20},
  ].map(e => ({...e, isTrusted: true}));
}
test('qualifies observed input separately; rejects the actual mixed-pointer failure and synthetic events', () => {
  assert.equal(qualify(observed()).product, 'unrun');
  const mixed = observed(); mixed[1].pointerId = 2;
  assert.throws(() => qualify(mixed), /mixed pointer/);
  const untrusted = observed(); untrusted[0].isTrusted = false;
  assert.throws(() => qualify(untrusted));
  assert.throws(() => qualify(observed().slice(0, -1)), /Shift/);
});

test('focused US typing uses real qcodes and balanced Shift edges; no raw numeric X keycodes', async () => {
  await fixture(async (path, commands) => {
    await sendPlan(new Qmp(path), {profile: 'mouse', actions: [{kind: 'text', layout: 'us', value: 'A2 _'}]});
    const events = commands.filter(c => c.execute === 'input-send-event').flatMap(c => c.arguments.events);
    assert.deepEqual(events.map(e => [e.data.key.data, e.data.down]), [
      ['shift', true], ['a', true], ['a', false], ['shift', false], ['2', true], ['2', false],
      ['spc', true], ['spc', false], ['shift', true], ['minus', true], ['minus', false], ['shift', false]]);
  });
  assert.throws(() => validatePlan({profile: 'mouse', actions: [{kind: 'text', layout: 'de', value: 'test'}]}));
  assert.throws(() => validatePlan({profile: 'mouse', actions: [{kind: 'text', layout: 'us', value: 'unhandled \u00e9'}]}));
});

test('target-readiness refusal while Shift is held releases it without pressing the button', async () => {
  await fixture(async (path, commands) => {
    await assert.rejects(sendPlan(new Qmp(path), {profile: 'mouse', actions: [
      {kind: 'key', code: 'shift', down: true}, {kind: 'button', down: true},
      {kind: 'button', down: false}, {kind: 'key', code: 'shift', down: false},
    ]}, 10000, undefined, async action => { if (action.kind === 'button') throw Error('target not ready'); }), /target not ready/);
    const events = commands.filter(c => c.execute === 'input-send-event').flatMap(c => c.arguments.events);
    assert.deepEqual(events.map(e => [e.type, e.data.down]), [['key', true], ['key', false]]);
  });
});
