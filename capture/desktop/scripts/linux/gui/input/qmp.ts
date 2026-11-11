// Host-side native input for the existing disposable guest runner. No DOM/XTest input.
import {createConnection, type Socket} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';

export class Qmp {
  socket: Socket;
  sequence = 0;
  pending = new Map<number, {resolve: (value: any) => void; reject: (error: Error) => void}>();
  greeting: Promise<void>;
  constructor(path: string) {
    this.socket = createConnection(path);
    let greet: () => void;
    let refuse: (error: Error) => void;
    this.greeting = new Promise((resolve, reject) => { greet = resolve; refuse = reject; });
    let buffer = '';
    const fail = (error: Error) => {
      refuse(error);
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    this.socket.on('error', fail);
    this.socket.on('close', () => fail(Error('QMP connection closed')));
    this.socket.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > 1024 * 1024) { fail(Error('QMP response exceeded limit')); this.close(); return; }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line);
          if (value.QMP) greet();
          const request = this.pending.get(value.id);
          if (request) {
            this.pending.delete(value.id);
            if (value.error) request.reject(Error(JSON.stringify(value.error)));
            else request.resolve(value.return);
          }
        } catch (error) { fail(error as Error); this.close(); }
      }
    });
  }
  async ready(deadline: number) {
    await bounded(this.greeting, deadline);
    await this.command('qmp_capabilities', {}, deadline);
  }
  async command(execute: string, args: object, deadline: number): Promise<any> {
    if (deadline <= performance.now()) throw Error('input deadline expired');
    const id = ++this.sequence;
    const result = new Promise((resolve, reject) => this.pending.set(id, {resolve, reject}));
    this.socket.write(JSON.stringify({execute, arguments: args, id}) + '\n');
    try { return await bounded(result, deadline); } finally { this.pending.delete(id); }
  }
  close() { this.socket.destroy(); }
}
async function bounded<T>(promise: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('input deadline expired')), Math.max(1, deadline - performance.now()));
    })]);
  } finally { clearTimeout(timer!); }
}
export type Action = {kind: 'relative'; x: number; y: number} |
  {kind: 'absolute'; x: number; y: number; width: number; height: number} |
  {kind: 'button'; down: boolean} | {kind: 'key'; code: string; down: boolean} |
  {kind: 'wait'; ms: number};
export type Plan = {profile: 'mouse' | 'tablet'; actions: Action[]};
export function validatePlan(value: any): asserts value is Plan {
  if (!value || !['mouse', 'tablet'].includes(value.profile) || !Array.isArray(value.actions) ||
      value.actions.length < 1 || value.actions.length > 1000) throw Error('invalid input plan');
  let button = false;
  const keys = new Set<string>();
  for (const action of value.actions) {
    if (!action || typeof action !== 'object') throw Error('invalid action');
    const integer = (n: any, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
    if (action.kind === 'relative') {
      if (value.profile !== 'mouse' || !integer(action.x, -32767, 32767) || !integer(action.y, -32767, 32767))
        throw Error('relative movement requires mouse profile and bounded integer deltas');
    } else if (action.kind === 'absolute') {
      if (value.profile !== 'tablet' || !integer(action.width, 2, 32768) || !integer(action.height, 2, 32768) ||
          !integer(action.x, 0, action.width - 1) || !integer(action.y, 0, action.height - 1))
        throw Error('absolute movement requires tablet profile and current framebuffer bounds');
    } else if (action.kind === 'button') {
      if (typeof action.down !== 'boolean' || action.down === button) throw Error('unpaired button edge');
      button = action.down;
    } else if (action.kind === 'key') {
      if (!/^[a-z][a-z0-9_-]{0,31}$/.test(action.code) || typeof action.down !== 'boolean' ||
          keys.has(action.code) === action.down) throw Error('invalid or unpaired QEMU qcode');
      if (action.down) keys.add(action.code); else keys.delete(action.code);
    } else if (action.kind !== 'wait' || !integer(action.ms, 0, 5000)) throw Error('invalid action');
  }
  if (button || keys.size) throw Error('plan leaves input held');
}
export async function sendPlan(qmp: Qmp, plan: Plan, timeoutMs = 10000, signal?: AbortSignal) {
  validatePlan(plan);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw Error('timeout must be 1000–60000 ms');
  const deadline = performance.now() + timeoutMs;
  const workDeadline = deadline - 500; // releases and device restoration share a fixed reserve
  const heldKeys = new Set<string>();
  let heldButton = false;
  let prior: number | undefined;
  let selected: number | undefined;
  let failure: unknown;
  const cleanup: string[] = [];
  const event = (events: any[], end = workDeadline) => qmp.command('input-send-event', {events}, end);
  const button = (down: boolean) => ({type: 'btn', data: {down, button: 'left'}});
  const key = (code: string, down: boolean) => ({type: 'key', data: {down, key: {type: 'qcode', data: code}}});
  const pause = async (ms: number) => {
    const available = workDeadline - performance.now();
    await delay(Math.max(0, Math.min(ms, available)), undefined, {signal});
    if (performance.now() >= workDeadline) throw Error('input deadline expired');
  };
  try {
    signal?.throwIfAborted();
    await qmp.ready(workDeadline);
    const mice = await qmp.command('query-mice', {}, workDeadline);
    const name = plan.profile === 'mouse' ? 'QEMU USB Mouse' : 'QEMU USB Tablet';
    const matches = mice.filter((mouse: any) => new RegExp(`^QEMU (USB|HID) ${plan.profile === 'mouse' ? 'Mouse' : 'Tablet'}$`).test(mouse.name) && mouse.absolute === (plan.profile === 'tablet'));
    if (matches.length !== 1) throw Error(`expected exactly one ${name}; boot runner with --input-profile ${plan.profile}; observed ${JSON.stringify(mice)}`);
    prior = mice.find((mouse: any) => mouse.current)?.index;
    selected = matches[0].index;
    await qmp.command('human-monitor-command', {'command-line': `mouse_set ${selected}`}, workDeadline);
    const readback = await qmp.command('query-mice', {}, workDeadline);
    if (!readback.some((mouse: any) => mouse.index === selected && mouse.current)) throw Error('input device selection did not apply');
    for (const action of plan.actions) {
      signal?.throwIfAborted();
      if (performance.now() >= workDeadline) throw Error('input deadline expired');
      if (action.kind === 'wait') await pause(action.ms);
      else if (action.kind === 'button') {
        if (action.down) heldButton = true; // include uncertain sends in cleanup
        await event([button(action.down)]);
        if (!action.down) heldButton = false;
        await pause(120);
      } else if (action.kind === 'key') {
        if (action.down) heldKeys.add(action.code);
        await event([key(action.code, action.down)]);
        if (!action.down) heldKeys.delete(action.code);
        await pause(120);
      } else {
        const type = action.kind === 'relative' ? 'rel' : 'abs';
        const x = action.kind === 'relative' ? action.x : Math.round(action.x * 32767 / (action.width - 1));
        const y = action.kind === 'relative' ? action.y : Math.round(action.y * 32767 / (action.height - 1));
        await event([{type, data: {axis: 'x', value: x}}, {type, data: {axis: 'y', value: y}}]);
        await pause(120);
      }
    }
  } catch (error) { failure = error; }
  finally {
    const attempt = async (operation: () => Promise<any>) => {
      try { await operation(); } catch (error) { cleanup.push(String(error)); }
    };
    if (heldButton) await attempt(() => event([button(false)], deadline));
    for (const code of heldKeys) await attempt(() => event([key(code, false)], deadline));
    if (prior !== undefined && prior !== selected) await attempt(async () => {
      await qmp.command('human-monitor-command', {'command-line': `mouse_set ${prior}`}, deadline);
      const restored = await qmp.command('query-mice', {}, deadline);
      if (!restored.some((mouse: any) => mouse.index === prior && mouse.current)) throw Error('prior input device was not restored');
    });
    qmp.close();
  }
  if (failure || cleanup.length) throw Error(JSON.stringify({failure: failure ? String(failure) : null, cleanup}));
  return {transport: 'passed', profile: plan.profile, actions: plan.actions.length,
    product: 'unrun', observation: 'unrun'};
}

// Native browser event logs qualify input, never the product under test.
export function qualify(events: any[]) {
  if (!Array.isArray(events) || events.some(e => !e || e.isTrusted !== true)) throw Error('expected observed event array');
  const start = events.findIndex(e => e.type === 'pointerdown' && e.button === 0);
  const end = events.findIndex((e, i) => i > start && e.type === 'pointerup' && e.button === 0);
  if (start < 0 || end < 0) throw Error('missing complete native pointer stroke');
  const stroke = events.slice(start, end + 1);
  const id = stroke[0].pointerId;
  const moves = stroke.filter(e => e.type === 'pointermove' && (e.buttons & 1));
  if (!Number.isInteger(id) || stroke.some(e => e.pointerId !== id) || moves.length < 2 ||
      new Set(moves.map(e => `${e.clientX},${e.clientY}`)).size < 2)
    throw Error('mixed pointer devices or no continuous held movement');
  // Omarchy's shift:both_capslock_cancel can label ShiftLeft keyup as CapsLock.
  // Join physical codes, then independently observe neutral pointer state.
  const shiftDown = events.findIndex((e, i) => i > end && e.type === 'keydown' && e.key === 'Shift' && ['ShiftLeft', 'ShiftRight'].includes(e.code));
  const shiftUp = events.findIndex((e, i) => i > shiftDown && e.type === 'keyup' && e.code === events[shiftDown]?.code);
  if (shiftDown < 0 || shiftUp < 0 || !events.some((e, i) => i > shiftDown && i < shiftUp && e.type === 'click' && e.shiftKey) ||
      events.at(-1)?.type !== 'pointermove' || events.at(-1)?.shiftKey !== false || events.at(-1)?.buttons !== 0)
    throw Error('missing Shift-click or input remains held');
  return {driver: 'passed', pointerId: id, heldMoves: moves.length, product: 'unrun'};
}
