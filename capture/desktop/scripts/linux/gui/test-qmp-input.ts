import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { QmpClient, parseCli } from './qmp-input.ts';

test('QMP input waits for negotiation and returns only after the HID event receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qmpi-'));
  const socketPath = join(root, 'q.sock');
  const events: unknown[] = [];
  let clientSocket: Socket | undefined;
  const server = createServer(socket => {
    clientSocket = socket;
    socket.setEncoding('utf8');
    socket.write('{"QMP":{"version":{},"capabilities":[]}}\r\n');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const request = JSON.parse(line) as { id: number; execute: string; arguments: { events?: unknown[] } };
        if (request.execute === 'input-send-event') events.push(...(request.arguments.events ?? []));
        socket.write(`${JSON.stringify({ return: {}, id: request.id })}\r\n`);
      }
    });
  });
  await new Promise<void>(resolve => server.listen(socketPath, resolve));
  const client = await QmpClient.connect(socketPath);
  try {
    await client.sendInput({ type: 'key', data: { down: true, key: { type: 'qcode', data: 'f23' } } });
    assert.deepEqual(events, [{ type: 'key', data: { down: true, key: { type: 'qcode', data: 'f23' } } }]);
  } finally {
    client.close();
    clientSocket?.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('pointer coordinates become separately acknowledged absolute axes', () => {
  const parsed = parseCli(['--socket', '/run/job/qmp.sock', '--event', 'pointer:16384,18636']);
  assert.deepEqual(parsed.events, [
    { type: 'abs', data: { axis: 'x', value: 16384 } },
    { type: 'abs', data: { axis: 'y', value: 18636 } },
  ]);
});
