import { ipcRenderer } from 'electron';
import type { CapabilitySnapshot, CommandResult, RecordCommand } from '@apparent/record/capabilities';
import type { RecordRendererPort } from './wire.js';
import {
  RECORD_CHANNELS, cloneCapabilitySnapshot, cloneCommandResult, cloneJsonDto,
  cloneRecordCommand, isRequestId,
} from './wire.js';

import { MICROPHONE_CHANNELS, microphoneReadiness, type MicrophoneRendererPort, type MicrophoneStart } from './omarchy/microphone-wire.ts';
import { DRAWING_CHANNELS, drawingAction, drawingSnapshot, type DrawingRendererPort } from './omarchy/drawing/wire.ts';

const READ_TIMEOUT_MS = 10_000;
const COMMAND_TIMEOUT_MS = 30_000;
const CONTROL_TIMEOUT_MS = 5_000;
let sequence = 0;

type Dict = Record<string, unknown>;
function exact(value: unknown, fields: readonly string[]): value is Dict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === fields.length && keys.every(key => typeof key === 'string' && fields.includes(key)
      && !!Object.getOwnPropertyDescriptor(value, key)?.enumerable
      && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
  } catch { return false; }
}

function requestId(): string {
  sequence = sequence >= Number.MAX_SAFE_INTEGER ? 1 : sequence + 1;
  return `record-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function invoke(channel: string, payload: unknown, timeout: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Record host transport timed out')), timeout);
    ipcRenderer.invoke(channel, payload).then(value => {
      clearTimeout(timer);
      resolve(value);
    }, error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/** Constructs the renderer's fixed Record capability; callers decide contextBridge exposure. */
export function createRecordPreloadPort(): RecordRendererPort {
  const listeners = new Set<(snapshot: CapabilitySnapshot) => void>();
  let subscriptionId: string | undefined;
  let desiredSubscription = false;
  let remoteSubscribed = false;
  let remoteUnknown = false;
  let controlTail: Promise<void> = Promise.resolve();
  let controlFailure: unknown;
  let ipcListenerInstalled = false;

  const notify = (snapshot: CapabilitySnapshot) => {
    for (const listener of [...listeners]) {
      try { listener(snapshot); }
      catch { listeners.delete(listener); }
    }
  };
  const onSnapshot = (_event: unknown, ...args: unknown[]) => {
    if (args.length !== 1 || !exact(args[0], ['subscriptionId', 'snapshot'])
      || args[0].subscriptionId !== subscriptionId) return;
    const snapshot = cloneCapabilitySnapshot(args[0].snapshot);
    if (snapshot) notify(snapshot);
  };
  const installIpcListener = () => {
    if (!ipcListenerInstalled) {
      ipcRenderer.on(RECORD_CHANNELS.snapshot, onSnapshot);
      ipcListenerInstalled = true;
    }
  };
  const removeIpcListener = () => {
    if (ipcListenerInstalled) {
      ipcRenderer.removeListener(RECORD_CHANNELS.snapshot, onSnapshot);
      ipcListenerInstalled = false;
    }
  };
  const queueControl = (operation: () => Promise<void>): Promise<void> => {
    const next = controlTail.then(operation);
    controlTail = next.then(() => { controlFailure = undefined; }, error => { controlFailure = error; });
    return next;
  };
  const reconcile = (): Promise<void> => queueControl(async () => {
    if (desiredSubscription) {
      if (remoteSubscribed) return;
      installIpcListener();
      const id = subscriptionId;
      if (!id) throw new Error('Missing Record subscription identity');
      const idForReply = requestId();
      let raw: unknown;
      try { raw = await invoke(RECORD_CHANNELS.subscribe, { requestId: idForReply, subscriptionId: id }, CONTROL_TIMEOUT_MS); }
      catch (error) { remoteUnknown = true; throw error; }
      const reply = cloneJsonDto(raw);
      if (!exact(reply, ['requestId', 'subscriptionId', 'subscribed']) || reply.requestId !== idForReply
        || reply.subscriptionId !== id || reply.subscribed !== true) {
        remoteUnknown = true;
        throw new Error('Invalid Record subscription acknowledgement');
      }
      remoteSubscribed = true;
      remoteUnknown = false;
      return;
    }
    removeIpcListener();
    if (!remoteSubscribed && !remoteUnknown) return;
    const id = subscriptionId;
    if (!id) return;
    const idForReply = requestId();
    const raw = await invoke(RECORD_CHANNELS.unsubscribe, { requestId: idForReply, subscriptionId: id }, CONTROL_TIMEOUT_MS);
    const reply = cloneJsonDto(raw);
    if (!exact(reply, ['requestId', 'subscriptionId', 'subscribed']) || reply.requestId !== idForReply
      || reply.subscriptionId !== id || reply.subscribed !== false) throw new Error('Invalid Record unsubscription acknowledgement');
    remoteSubscribed = false;
    remoteUnknown = false;
  });

  const read = async (...extra: unknown[]): Promise<CapabilitySnapshot> => {
    if (extra.length) throw new TypeError('Invalid Record read request');
    if (listeners.size) {
      await controlTail;
      if (controlFailure) throw new Error('Record observation subscription unavailable');
    }
    const id = requestId();
    const raw: unknown = await invoke(RECORD_CHANNELS.read, { requestId: id }, READ_TIMEOUT_MS);
    const reply = cloneJsonDto(raw);
    if (!exact(reply, ['requestId', 'snapshot']) || reply.requestId !== id) throw new Error('Invalid Record snapshot handshake');
    const snapshot = cloneCapabilitySnapshot(reply.snapshot);
    if (!snapshot) throw new Error('Invalid Record capability snapshot');
    return snapshot;
  };

  const execute = async (command: RecordCommand, ...extra: unknown[]): Promise<CommandResult> => {
    if (extra.length) throw new TypeError('Invalid Record command arguments');
    const safeCommand = cloneRecordCommand(command);
    if (!safeCommand) throw new TypeError('Invalid Record command DTO');
    const id = safeCommand.requestId;
    try {
      const raw: unknown = await invoke(RECORD_CHANNELS.execute, { requestId: id, command: safeCommand }, COMMAND_TIMEOUT_MS);
      const reply = cloneJsonDto(raw);
      if (!exact(reply, ['requestId', 'result']) || reply.requestId !== id) throw new Error('Invalid Record command correlation');
      const result = cloneCommandResult(reply.result, id);
      if (!result) throw new Error('Invalid Record command result');
      return result;
    } catch (error) {
      // This port has no authority to infer dispatch or outcome after invoke begins.
      // The renderer RecordClient maps rejection to outcome-unknown from its cache.
      throw error;
    }
  };

  const observe = (listener: (snapshot: CapabilitySnapshot) => void, ...extra: unknown[]): (() => void) => {
    if (extra.length || typeof listener !== 'function') throw new TypeError('Invalid Record observer');
    const first = listeners.size === 0;
    listeners.add(listener);
    if (first) {
      desiredSubscription = true;
      subscriptionId ??= requestId();
      installIpcListener();
      void reconcile().catch(() => {}); // One attempt per requested subscription; no command retries.
    }
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      listeners.delete(listener);
      if (!listeners.size) {
        desiredSubscription = false;
        removeIpcListener();
        void reconcile().catch(() => {});
      }
    };
  };

  return Object.freeze({ read, execute, observe });
}

/** Explicit microphone action only; renderer never supplies model/source paths. */
export function createMicrophonePreloadPort():MicrophoneRendererPort{
  return Object.freeze({
    async read(...extra:unknown[]){
      if(extra.length)throw new TypeError('Invalid microphone read');
      const id=requestId(),reply=cloneJsonDto(await invoke(MICROPHONE_CHANNELS.read,{requestId:id},READ_TIMEOUT_MS));
      if(!exact(reply,['requestId','readiness'])||reply.requestId!==id)throw new Error('Invalid microphone readiness');
      const ready=microphoneReadiness(reply.readiness);if(!ready)throw new Error('Invalid microphone readiness');return ready;
    },
    async start(command:MicrophoneStart,...extra:unknown[]){
      if(extra.length)throw new TypeError('Invalid microphone command');
      const safe=cloneRecordCommand(command);if(!safe||safe.type!=='start-capture')throw new TypeError('Invalid microphone command');
      // Rejection after invoke stays unknown; the renderer must not retry.
      const reply=cloneJsonDto(await invoke(MICROPHONE_CHANNELS.start,{requestId:safe.requestId,command:safe},COMMAND_TIMEOUT_MS));
      if(!exact(reply,['requestId','result'])||reply.requestId!==safe.requestId)throw new Error('Invalid microphone command correlation');
      const result=cloneCommandResult(reply.result,safe.requestId);if(!result)throw new Error('Invalid microphone result');return result;
    },
  });
}

/** Fixed intents only. No renderer-supplied points, native identity or resource paths. */
export function createDrawingPreloadPort():DrawingRendererPort{
  return Object.freeze({
    async read(...extra:unknown[]){
      if(extra.length)throw new TypeError('Invalid drawing read');
      const id=requestId(),reply=cloneJsonDto(await invoke(DRAWING_CHANNELS.read,{requestId:id},READ_TIMEOUT_MS));
      if(!exact(reply,['requestId','snapshot'])||reply.requestId!==id)throw new Error('Invalid drawing correlation');
      const snapshot=drawingSnapshot(reply.snapshot);if(!snapshot)throw new Error('Invalid drawing snapshot');return snapshot;
    },
    async act(value:unknown,...extra:unknown[]){
      const action=drawingAction(value);if(extra.length||!action)throw new TypeError('Invalid drawing action');
      const id=requestId();
      try{
        const reply=cloneJsonDto(await invoke(DRAWING_CHANNELS.act,{requestId:id,action},CONTROL_TIMEOUT_MS));
        if(!exact(reply,['requestId','outcome'])||reply.requestId!==id||!['requested','refused','outcome-unknown'].includes(String(reply.outcome)))throw new Error('Invalid drawing outcome');
        return reply.outcome as 'requested'|'refused'|'outcome-unknown';
      }catch{return 'outcome-unknown' as const;}
    },
  });
}
