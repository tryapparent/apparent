import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BrowserWindow } from 'electron';
import type { NativeControlSurfaceIdentity } from '@apparent/app-contracts/native';

const hostEpoch = randomUUID();
let generation = 0;
const identities = new WeakMap<BrowserWindow, NativeControlSurfaceIdentity>();

export function nativeWindowId(mediaSourceId: string): number {
  const match = /^window:([1-9][0-9]*):[0-9]+$/.exec(mediaSourceId);
  const id = match ? Number(match[1]) : NaN;
  if (!Number.isSafeInteger(id) || id > 0xffff_ffff) throw new Error('Native window identity unavailable');
  return id;
}

/** /proc stat's comm can contain spaces and parentheses; field 22 follows its final delimiter. */
export function linuxStartTicks(stat: string): string {
  const delimiter = stat.lastIndexOf(') ');
  const fields = delimiter < 0 ? [] : stat.slice(delimiter + 2).trim().split(/\s+/);
  const ticks = fields[19];
  if (!ticks || !/^[1-9][0-9]*$/.test(ticks) || BigInt(ticks) > 0xffff_ffff_ffff_ffffn) {
    throw new Error('Process incarnation unavailable');
  }
  return ticks;
}

function processIncarnation(): NativeControlSurfaceIdentity['owner']['incarnation'] {
  if (process.platform === 'linux') {
    const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootId)) {
      throw new Error('Boot incarnation unavailable');
    }
    return { kind: 'linux-proc-start', bootId,
      startTicks: linuxStartTicks(readFileSync('/proc/self/stat', 'utf8')) };
  }
  if (process.platform === 'darwin') {
    const value = process.getCreationTime?.();
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new Error('Process creation observation unavailable');
    }
    return { kind: 'electron-process-creation-unix-ms', value };
  }
  throw new Error('Control surface platform unavailable');
}

/**
 * Called only by trusted main after creating a hidden window. Linux callers
 * must have selected Electron's X11 backend before readiness. Engine must
 * independently verify native ownership/incarnation and apply its filter.
 */
export function identifyHiddenControlSurface(window: BrowserWindow, backend: 'x11' | 'appkit'): NativeControlSurfaceIdentity {
  if (!process.versions.electron || process.type !== 'browser' || window.isDestroyed() || window.isVisible()) {
    throw new Error('Control surface must be hidden in the owning Electron process');
  }
  if ((process.platform === 'linux' && backend !== 'x11')
    || (process.platform === 'darwin' && backend !== 'appkit')) throw new Error('Control surface backend mismatch');
  const id = nativeWindowId(window.getMediaSourceId());
  const previous = identities.get(window);
  if (previous) {
    if (previous.window.id !== id) throw new Error('Native window identity changed');
    return previous;
  }
  const incarnation = Object.freeze(processIncarnation());
  if (window.isDestroyed() || window.isVisible() || nativeWindowId(window.getMediaSourceId()) !== id) {
    throw new Error('Control surface changed during identity observation');
  }
  if (!Number.isSafeInteger(generation + 1)) throw new Error('Control surface generation exhausted');
  const identity: NativeControlSurfaceIdentity = Object.freeze({ api: 1, hostEpoch,
    surfaceId: randomUUID(), generation: ++generation,
    owner: Object.freeze({ pid: process.pid, incarnation }),
    window: Object.freeze({ kind: backend === 'x11' ? 'x11' : 'cg-window', id }),
  });
  identities.set(window, identity);
  return identity;
}
