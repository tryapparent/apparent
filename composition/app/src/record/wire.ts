import type { CapabilitySnapshot, CommandResult, RecordCommand } from '@apparent/record/capabilities';

/** The renderer gets this narrow capability, never Electron IPC primitives. */
export interface RecordRendererPort {
  read(): Promise<CapabilitySnapshot>;
  execute(command: RecordCommand): Promise<CommandResult>;
  observe(listener: (snapshot: CapabilitySnapshot) => void): () => void;
}

export const RECORD_CHANNELS = Object.freeze({
  read: 'apparent:record:read',
  execute: 'apparent:record:execute',
  subscribe: 'apparent:record:subscribe',
  unsubscribe: 'apparent:record:unsubscribe',
  snapshot: 'apparent:record:snapshot',
});

export const MAX_RECORD_BYTES = 64 * 1024;
const MAX_DEPTH = 24;
const MAX_NODES = 12_000;
const MAX_ARRAY = 2_048;
const encoder = new TextEncoder();
const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype', 'toJSON']);

type Dict = Record<string, unknown>;
const object = (value: unknown): value is Dict => !!value && typeof value === 'object' && !Array.isArray(value);

function exact(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Dict {
  if (!object(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) return false;
    const keys = Reflect.ownKeys(value);
    const allowed = new Set([...required, ...optional]);
    if (required.some(key => !Object.hasOwn(value, key)) || keys.length < required.length
      || keys.some(key => typeof key !== 'string' || !allowed.has(key) || forbiddenKeys.has(key))) return false;
    return keys.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && 'value' in descriptor;
    });
  } catch { return false; }
}

function plainArray(value: unknown, maximum = MAX_ARRAY): value is unknown[] {
  if (!Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
      || Object.getOwnPropertySymbols(value).length) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
    return keys.filter(key => key !== 'length').every((key, index) => {
      if (key !== String(index)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !!descriptor?.enumerable && 'value' in descriptor;
    });
  } catch { return false; }
}

/** Validate before stringify so getters, sparse arrays and exotic graphs never run. */
function cloneJson(value: unknown): unknown | undefined {
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  const charge = (text: string) => {
    bytes += encoder.encode(text).length;
    if (bytes > MAX_RECORD_BYTES) throw new TypeError('Record DTO exceeds the transport size limit');
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) throw new TypeError('Record DTO exceeds transport complexity limits');
    if (item === null || typeof item === 'boolean') { bytes++; return; }
    if (typeof item === 'string') { charge(item); return; }
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!item || typeof item !== 'object' || ancestors.has(item)) throw new TypeError('Record DTO must be plain JSON');
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (!plainArray(item)) throw new TypeError('Record DTO arrays must be dense plain arrays');
      for (const child of item) visit(child, depth + 1);
    } else {
      if (!exact(item, [], Reflect.ownKeys(item).filter((key): key is string => typeof key === 'string'))) {
        throw new TypeError('Record DTO objects must contain only plain data fields');
      }
      for (const key of Reflect.ownKeys(item)) {
        if (typeof key !== 'string' || forbiddenKeys.has(key)) throw new TypeError('Record DTO has an unsafe key');
        charge(key);
        visit(Object.getOwnPropertyDescriptor(item, key)!.value, depth + 1);
      }
    }
    ancestors.delete(item);
  };
  try {
    visit(value, 0);
    const encoded = JSON.stringify(value);
    if (encoded === undefined || encoder.encode(encoded).length > MAX_RECORD_BYTES) return undefined;
    return JSON.parse(encoded) as unknown;
  } catch { return undefined; }
}

const text = (value: unknown, maximum = 512, nonempty = false): value is string =>
  typeof value === 'string' && encoder.encode(value).length <= maximum && (!nonempty || value.length > 0);
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && choices.includes(value as T);
const colors = ['coral', 'purple', 'blue', 'green'] as const;
const repairs = ['request-permission', 'open-system-settings', 'request-safe-relaunch'] as const;

function validRequirement(value: unknown): boolean {
  return exact(value, ['id', 'required', 'status', 'usableNow', 'relaunchNeeded', 'allowedRepairActions'])
    && text(value.id, 256, true) && bool(value.required)
    && oneOf(value.status, ['granted', 'denied', 'not-determined', 'unavailable'] as const)
    && bool(value.usableNow) && bool(value.relaunchNeeded) && plainArray(value.allowedRepairActions, 8)
    && value.allowedRepairActions.every(action => oneOf(action, repairs));
}

function validShortcut(value: unknown): boolean {
  if (!exact(value, ['effective', 'label', 'registration', 'externallyManaged', 'draft'], ['configured', 'bindingId'])) return false;
  const nullableText = (item: unknown, max = 256) => item === null || text(item, max);
  if (!nullableText(value.effective) || !nullableText(value.label)
    || (value.configured !== undefined && !nullableText(value.configured))
    || (value.bindingId !== undefined && !text(value.bindingId, 256, true))
    || !oneOf(value.registration, ['registered', 'unregistered', 'externally-managed', 'unknown', 'unavailable'] as const)
    || !bool(value.externallyManaged)) return false;
  if (value.draft === null) return true;
  return exact(value.draft, ['sessionId', 'value'], ['error'])
    && text(value.draft.sessionId, 256, true) && text(value.draft.value, 256, true)
    && (value.draft.error === undefined || text(value.draft.error, 4_096));
}

const trialBindingFields = ['sourceEpoch', 'sourceRevision', 'bindingId', 'effectiveBinding'];
function validTrialBindingValues(value: Dict): boolean {
  return text(value.sourceEpoch, 256, true) && revision(value.sourceRevision)
    && text(value.bindingId, 256, true) && text(value.effectiveBinding, 256, true);
}
function validTrialBeginBinding(value: unknown): boolean {
  return exact(value, trialBindingFields) && validTrialBindingValues(value);
}
function validTrialPredecessor(value: unknown): value is Dict {
  return exact(value, [...trialBindingFields, 'reservationId']) && validTrialBindingValues(value)
    && text(value.reservationId, 256, true);
}

function validShortcutTrial(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.state === 'unavailable') return exact(value, ['state']);

  const binding = ['sourceEpoch', 'sourceRevision', 'bindingId', 'effectiveBinding'];
  if (!text(value.sourceEpoch, 256, true) || !revision(value.sourceRevision)
    || !text(value.bindingId, 256, true) || !text(value.effectiveBinding, 256, true)) return false;
  const validTime = (item: unknown) => text(item, 128, true) && Number.isFinite(Date.parse(item));

  if (value.state === 'idle') return exact(value, ['state', ...binding]);
  if (value.state === 'reserved' || value.state === 'pressing') {
    return exact(value, ['state', ...binding, 'reservationId', 'expiresAt'])
      && text(value.reservationId, 256, true) && validTime(value.expiresAt);
  }
  if (value.state === 'observed') {
    if (!exact(value, ['state', ...binding, 'reservationId', 'pressId', 'pressedAt', 'releasedAt'])
      || !text(value.reservationId, 256, true) || !text(value.pressId, 256, true)
      || !validTime(value.pressedAt) || !validTime(value.releasedAt)) return false;
    return Date.parse(value.releasedAt as string) >= Date.parse(value.pressedAt as string);
  }
  if (value.state === 'expired' || value.state === 'cancelled' || value.state === 'unknown') {
    return exact(value, ['state', ...binding, 'reservationId']) && text(value.reservationId, 256, true);
  }
  return false;
}

function validPen(value: unknown): boolean {
  return exact(value, ['effective', 'supported'], ['error'])
    && (value.effective === null || oneOf(value.effective, colors))
    && plainArray(value.supported, 4) && value.supported.every(color => oneOf(color, colors))
    && (value.error === undefined || text(value.error, 4_096));
}

function validPicker(value: Dict): boolean {
  if (value.ok === true) return exact(value, ['kind', 'at', 'ok', 'surface', 'target'])
    && value.kind === 'picker' && text(value.at, 128, true) && value.surface === 'screen'
    && oneOf(value.target, ['display', 'area', 'window'] as const);
  return exact(value, ['kind', 'at', 'ok', 'reason']) && value.kind === 'picker' && value.ok === false
    && text(value.at, 128, true) && oneOf(value.reason, ['cancelled', 'failed', 'unavailable'] as const);
}

function validStrokeCursor(value: unknown): boolean {
  return exact(value, ['historyId', 'sequence']) && text(value.historyId, 256, true) && revision(value.sequence);
}

function validStroke(value: Dict): boolean {
  if (value.ok === true) return exact(value, ['kind', 'at', 'ok', 'surface', 'strokeId'], ['cursor'])
    && value.kind === 'accepted-stroke' && text(value.at, 128, true)
    && oneOf(value.surface, ['screen', 'whiteboard'] as const) && text(value.strokeId, 256, true)
    && (value.cursor === undefined || (value.surface === 'screen' && validStrokeCursor(value.cursor)));
  return exact(value, ['kind', 'at', 'ok', 'surface', 'reason']) && value.kind === 'accepted-stroke' && value.ok === false
    && text(value.at, 128, true) && oneOf(value.surface, ['screen', 'whiteboard'] as const)
    && oneOf(value.reason, ['rejected', 'failed'] as const);
}

function validOutcome(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.kind === 'picker') return validPicker(value);
  if (value.kind === 'accepted-stroke') return validStroke(value);
  if (value.kind === 'note-save') {
    if (value.ok === true) return exact(value, ['kind', 'at', 'ok', 'noteId', 'receiptId', 'screenStrokeBarrier'])
      && text(value.at, 128, true) && text(value.noteId, 256, true) && text(value.receiptId, 256, true)
      && validStrokeCursor(value.screenStrokeBarrier);
    return exact(value, ['kind', 'at', 'ok', 'reason']) && value.ok === false
      && text(value.at, 128, true) && oneOf(value.reason, ['draft', 'empty', 'failed', 'cancelled'] as const);
  }
  if (value.kind === 'artifact-open') {
    if (value.ok === true) return exact(value, ['kind', 'at', 'artifactId', 'ok', 'evidence'])
      && text(value.at, 128, true) && text(value.artifactId, 256, true)
      && oneOf(value.evidence, ['viewer-ack', 'os-observation'] as const);
    return exact(value, ['kind', 'at', 'artifactId', 'ok', 'reason']) && value.ok === false
      && text(value.at, 128, true) && text(value.artifactId, 256, true)
      && oneOf(value.reason, ['refused', 'failed'] as const);
  }
  if (value.kind === 'copy' && 'evidence' in value) {
    return exact(value, ['kind', 'at', 'ok', 'evidence', 'artifactId', 'requestId', 'digest', 'byteLength'])
      && value.ok === true && oneOf(value.evidence, ['native-write-readback', 'native-text-readback'] as const)
      && text(value.at, 128, true)
      && text(value.artifactId, 256, true) && isRequestId(value.requestId)
      && typeof value.digest === 'string' && /^[0-9a-f]{64}$/.test(value.digest)
      && revision(value.byteLength) && value.byteLength > 0;
  }
  return exact(value, ['kind', 'at', 'ok'], ['detail'])
    && oneOf(value.kind, ['shortcut', 'first-frame-start', 'whiteboard', 'processing', 'save', 'copy', 'open-dispatch'] as const)
    && text(value.at, 128, true) && bool(value.ok)
    && (value.detail === undefined || text(value.detail, 4_096));
}

function validTranscriptStatus(value: unknown): value is Dict {
  return (exact(value, ['state']) && value.state === 'unavailable')
    || (exact(value, ['state', 'content', 'segmentCount']) && value.state === 'collected'
      && oneOf(value.content, ['empty', 'nonempty'] as const)
      && revision(value.segmentCount) && value.segmentCount <= 100_000);
}
function validWarnings(value: unknown): boolean {
  if (!plainArray(value, 2)) return false;
  const kinds = new Set<string>();
  return value.every(warning => {
    if (!(exact(warning, ['kind', 'atMs']) && warning.kind === 'audioInitialGap' && revision(warning.atMs))
      && !(exact(warning, ['kind']) && warning.kind === 'transcriptUnavailable')) return false;
    if (kinds.has(warning.kind)) return false;
    kinds.add(warning.kind); return true;
  });
}
function validCapture(value: unknown): boolean {
  if (!exact(value, ['captureId', 'delivery', 'phase', 'outcomes'], ['invocationId', 'shortcutAdmissionId', 'artifactId', 'warnings', 'transcriptStatus'])) return false;
  return text(value.captureId, 256, true)
    && (value.invocationId === undefined || text(value.invocationId, 256, true))
    && oneOf(value.delivery, ['local-only', 'host-default', 'unknown'] as const)
    && (value.shortcutAdmissionId === undefined || text(value.shortcutAdmissionId, 256, true))
    && (value.artifactId === undefined || text(value.artifactId, 256, true))
    // Preserve original facts only. Neither Saved nor microphone readiness
    // supplies a transcript status or an observed interval.
    && (!Object.hasOwn(value, 'warnings') || validWarnings(value.warnings))
    && (!Object.hasOwn(value, 'transcriptStatus') || (value.phase === 'saved'
      && text(value.artifactId, 256, true) && validTranscriptStatus(value.transcriptStatus)
      && !(value.transcriptStatus.state === 'collected' && Array.isArray(value.warnings)
        && value.warnings.some(warning => warning.kind === 'transcriptUnavailable'))))
    && oneOf(value.phase, ['starting', 'recording', 'processing', 'saved', 'cancelled', 'failed', 'unknown'] as const)
    && plainArray(value.outcomes, 256) && value.outcomes.every(validOutcome);
}

function validAdmission(value: unknown): boolean {
  if (!object(value)) return false;
  if (value.state === 'unavailable' || value.state === 'idle') return exact(value, ['state']);
  if (value.state === 'armed') return exact(value, ['state', 'admissionId', 'delivery', 'expiresAt'])
    && text(value.admissionId, 256, true) && oneOf(value.delivery, ['local-only', 'host-default'] as const)
    && text(value.expiresAt, 128, true);
  if (value.state === 'consumed') return exact(value, ['state', 'admissionId', 'captureId'])
    && text(value.admissionId, 256, true) && text(value.captureId, 256, true);
  if (value.state === 'cancelled' || value.state === 'expired') return exact(value, ['state', 'admissionId'])
    && text(value.admissionId, 256, true);
  return false;
}

function validSnapshotShape(value: unknown): value is CapabilitySnapshot {
  return exact(value, ['version', 'providerEpoch', 'revision', 'connection', 'readiness', 'shortcut', 'pen', 'captures', 'nextShortcutAdmission'], ['shortcutTrial', 'shortcutTrialBeginBinding'])
    && value.version === 2 && text(value.providerEpoch, 256, true) && revision(value.revision)
    && oneOf(value.connection, ['connected', 'disconnected'] as const)
    && exact(value.readiness, ['requirements']) && plainArray(value.readiness.requirements, 256)
    && value.readiness.requirements.every(validRequirement) && validShortcut(value.shortcut) && validPen(value.pen)
    && plainArray(value.captures, 1_024) && value.captures.every(validCapture) && validAdmission(value.nextShortcutAdmission)
    && (value.shortcutTrial === undefined || validShortcutTrial(value.shortcutTrial))
    && (value.shortcutTrialBeginBinding === undefined || validTrialBeginBinding(value.shortcutTrialBeginBinding));
}

export function cloneCapabilitySnapshot(value: unknown): CapabilitySnapshot | undefined {
  const cloned = cloneJson(value);
  return validSnapshotShape(cloned) ? cloned : undefined;
}

function commandShape(value: unknown): value is RecordCommand {
  if (!object(value) || !text(value.requestId, 128, true)
    || !exact(value.expected, ['providerEpoch', 'revision'])
    || !text(value.expected.providerEpoch, 256, true) || !revision(value.expected.revision)) return false;
  const fields: Record<string, readonly string[]> = {
    refresh: [], 'request-permission': ['requirementId'], 'open-system-settings': ['requirementId'],
    'request-safe-relaunch': [], 'shortcut-begin-edit': [], 'shortcut-submit': ['sessionId', 'value'],
    'shortcut-save': ['sessionId'], 'shortcut-cancel': ['sessionId'], 'shortcut-reset': [],
    'shortcut-open-desktop-config': [], 'select-pen': ['value'], 'start-capture': ['delivery'],
    'begin-shortcut-trial': ['reservationId', 'bindingId', 'effectiveBinding', 'sourceEpoch', 'sourceRevision', 'expiresAt'],
    'cancel-shortcut-trial': ['reservationId'],
    'arm-next-shortcut': ['admissionId', 'delivery', 'expiresAt'], 'cancel-next-shortcut': ['admissionId'],
    'stop-capture': ['captureId'], 'cancel-capture': ['captureId'], 'inspect-capture': ['captureId'],
    'copy-local': ['captureId'], 'open-capture': ['captureId'],
  };
  if (typeof value.type !== 'string' || !Object.hasOwn(fields, value.type)) return false;
  if (!exact(value, ['type', 'requestId', 'expected', ...fields[value.type]],
    value.type === 'begin-shortcut-trial' ? ['replaces'] : [])) return false;
  switch (value.type) {
    case 'request-permission': case 'open-system-settings': return text(value.requirementId, 256, true);
    case 'shortcut-submit': return text(value.sessionId, 256, true) && text(value.value, 256, true);
    case 'shortcut-save': case 'shortcut-cancel': return text(value.sessionId, 256, true);
    case 'begin-shortcut-trial': return text(value.reservationId, 256, true) && text(value.bindingId, 256, true)
      && text(value.effectiveBinding, 256, true) && text(value.sourceEpoch, 256, true)
      && revision(value.sourceRevision) && text(value.expiresAt, 128, true) && Number.isFinite(Date.parse(value.expiresAt))
      && (value.replaces === undefined || (validTrialPredecessor(value.replaces)
        && value.replaces.reservationId !== value.reservationId));
    case 'cancel-shortcut-trial': return text(value.reservationId, 256, true);
    case 'select-pen': return oneOf(value.value, colors);
    case 'start-capture': return oneOf(value.delivery, ['local-only', 'host-default'] as const);
    case 'arm-next-shortcut': return text(value.admissionId, 256, true)
      && oneOf(value.delivery, ['local-only', 'host-default'] as const) && text(value.expiresAt, 128, true);
    case 'cancel-next-shortcut': return text(value.admissionId, 256, true);
    case 'stop-capture': case 'cancel-capture': case 'inspect-capture': case 'copy-local': case 'open-capture':
      return text(value.captureId, 256, true);
    default: return true;
  }
}

export function cloneRecordCommand(value: unknown): RecordCommand | undefined {
  const cloned = cloneJson(value);
  return commandShape(cloned) ? cloned : undefined;
}

export function cloneCommandResult(value: unknown, requestId: string): CommandResult | undefined {
  const cloned = cloneJson(value);
  if (!object(cloned) || cloned.requestId !== requestId || !text(cloned.requestId, 128, true)
    || !cloneCapabilitySnapshot(cloned.snapshot)) return undefined;
  if (cloned.status === 'accepted' || cloned.status === 'cancelled' || cloned.status === 'outcome-unknown'
    || cloned.status === 'written-readback') {
    return exact(cloned, ['status', 'requestId', 'snapshot']) ? cloned as unknown as CommandResult : undefined;
  }
  if (cloned.status === 'refused') return exact(cloned, ['status', 'requestId', 'reason', 'snapshot'])
    && text(cloned.reason, 4_096) ? cloned as unknown as CommandResult : undefined;
  if (cloned.status === 'applied') {
    if (!exact(cloned, ['status', 'requestId', 'snapshot'], ['receipt'])) return undefined;
    if (cloned.receipt !== undefined && (!exact(cloned.receipt, [], ['captureId'])
      || (cloned.receipt.captureId !== undefined && !text(cloned.receipt.captureId, 256, true)))) return undefined;
    return cloned as unknown as CommandResult;
  }
  return undefined;
}

export function isRequestId(value: unknown): value is string { return text(value, 128, true); }
export function cloneJsonDto(value: unknown): unknown | undefined { return cloneJson(value); }

export function snapshotIsNewer(current: CapabilitySnapshot, next: CapabilitySnapshot, retired: Set<string>): boolean {
  if (next.providerEpoch === current.providerEpoch) return next.revision > current.revision;
  return !retired.has(next.providerEpoch);
}
