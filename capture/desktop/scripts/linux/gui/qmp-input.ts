import { lstat } from 'node:fs/promises';
import { createConnection, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Keep the QMP key identity explicit: `number` is QEMU's input protocol value,
// while `qcode` names a QEMU key. Neither is an XKB keycode.
export type QmpKey = { type: 'number'; data: number } | { type: 'qcode'; data: string };
export type QmpInputEvent =
  | { type: 'key'; data: { down: boolean; key: QmpKey } }
  | { type: 'btn'; data: { down: boolean; button: 'left' | 'middle' | 'right' } }
  | { type: 'abs'; data: { axis: 'x' | 'y'; value: number } };

type Message = Record<string, unknown>;

export class QmpClient {
  private nextId = 0;
  private buffer = '';
  private greeting: Message | null = null;
  private greetingWaiter: ((message: Message) => void) | null = null;
  private readonly waiting = new Map<number, (message: Message) => void>();
  private readonly socket: Socket;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.on('data', chunk => this.receive(chunk));
  }

  static async connect(socketPath: string): Promise<QmpClient> {
    const info = await lstat(socketPath);
    if (!info.isSocket() || info.isSymbolicLink()) throw new Error('QMP path must be a Unix socket');
    const socket = createConnection(socketPath);
    const client = new QmpClient(socket);
    const greeting = await client.readGreeting();
    if (!greeting.QMP || typeof greeting.QMP !== 'object') {
      socket.destroy();
      throw new Error('QMP greeting missing');
    }
    await client.command('qmp_capabilities');
    return client;
  }

  async command(execute: string, arguments_: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.nextId;
    const result = this.readMessage(id);
    this.socket.write(`${JSON.stringify({ execute, arguments: arguments_, id })}\n`);
    const response = await result;
    if (response.error) throw new Error(`QMP ${execute} rejected: ${JSON.stringify(response.error)}`);
    if (!('return' in response)) throw new Error(`QMP ${execute} returned no result`);
    return response.return;
  }

  async sendInput(event: QmpInputEvent): Promise<void> {
    await this.command('input-send-event', { events: [event] });
  }

  async screendump(path: string): Promise<void> {
    const quoted = path.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    await this.command('human-monitor-command', { 'command-line': `screendump "${quoted}"` });
  }

  close(): void {
    this.socket.end();
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message: Message;
      try { message = JSON.parse(line) as Message; }
      catch { this.socket.destroy(new Error('Invalid QMP JSON')); return; }
      if (typeof message.id === 'number') this.waiting.get(message.id)?.(message);
      else if (message.QMP) {
        this.greeting = message;
        this.greetingWaiter?.(message);
        this.greetingWaiter = null;
      }
    }
  }

  private readGreeting(): Promise<Message> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off('error', onError);
        this.socket.off('close', onClose);
      };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onClose = () => { cleanup(); reject(new Error('QMP socket closed')); };
      const timer = setTimeout(() => {
        this.greetingWaiter = null;
        cleanup();
        reject(new Error('QMP greeting timed out'));
      }, 3000);
      if (this.greeting) { cleanup(); resolve(this.greeting); return; }
      this.greetingWaiter = message => { cleanup(); resolve(message); };
      this.socket.once('error', onError);
      this.socket.once('close', onClose);
    });
  }

  private readMessage(id: number): Promise<Message> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.waiting.delete(id);
        this.socket.off('error', onError);
        this.socket.off('close', onClose);
      };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onClose = () => { cleanup(); reject(new Error('QMP socket closed')); };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('QMP response timed out'));
      }, 3000);
      this.waiting.set(id, message => { cleanup(); resolve(message); });
      this.socket.once('error', onError);
      this.socket.once('close', onClose);
    });
  }
}

function usage(): never {
  throw new Error('Usage: qmp-input.ts --socket PATH --event key-down:number:N|key-up:number:N|key-down:qcode:NAME|key-up:qcode:NAME|pointer:X,Y|button-down:left|button-up:left [--delay-ms N] [--screendump PATH]. Keys use QMP identities (not XKB codes); pointer axes use QEMU 0..32767 device coordinates.');
}

export function parseCli(args: string[]): { socket: string; events: QmpInputEvent[]; delayMs: number; screendump?: string } {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!key?.startsWith('--') || value === undefined || values.has(key)) usage();
    values.set(key, value);
  }
  const socket = values.get('--socket'), raw = values.get('--event');
  if (!socket || !raw) usage();
  const parts = raw.split(':');
  let events: QmpInputEvent[];
  if ((parts[0] === 'key-down' || parts[0] === 'key-up') && parts[1] === 'number' && /^\d+$/.test(parts[2] ?? '')) {
    events = [{ type: 'key', data: { down: parts[0] === 'key-down', key: { type: 'number', data: Number(parts[2]) } } }];
  } else if ((parts[0] === 'key-down' || parts[0] === 'key-up') && parts[1] === 'qcode' && /^[a-z0-9_]+$/i.test(parts[2] ?? '')) {
    events = [{ type: 'key', data: { down: parts[0] === 'key-down', key: { type: 'qcode', data: parts[2] } } }];
  } else if (parts[0] === 'button-down' || parts[0] === 'button-up') {
    if (!['left', 'middle', 'right'].includes(parts[1] ?? '')) usage();
    events = [{ type: 'btn', data: { down: parts[0] === 'button-down', button: parts[1] as 'left' | 'middle' | 'right' } }];
  } else if (parts[0] === 'pointer') {
    const [x, y] = (parts[1] ?? '').split(',').map(Number);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 32767 || y > 32767) usage();
    events = [
      { type: 'abs', data: { axis: 'x', value: x } },
      { type: 'abs', data: { axis: 'y', value: y } },
    ];
  } else usage();
  const delayMs = Number(values.get('--delay-ms') ?? '150');
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 2000) usage();
  return { socket, events, delayMs, screendump: values.get('--screendump') };
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const client = await QmpClient.connect(options.socket);
  try {
    for (const event of options.events) {
      await client.sendInput(event);
      await new Promise(resolve => setTimeout(resolve, options.delayMs));
    }
    if (options.screendump) await client.screendump(options.screendump);
    process.stdout.write(`${JSON.stringify({ qmpAcknowledged: true, events: options.events, screendump: options.screendump ?? null })}\n`);
  } finally { client.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
