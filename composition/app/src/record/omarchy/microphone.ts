import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { CommandResult } from '@apparent/record/capabilities';
import type { MicrophoneReadiness } from './microphone-wire.ts';

export const SPEECH_PROFILE = 'parakeet-unified-en-0.6b-Q8_0' as const;
export const SPEECH_MODEL_BYTES = 731_357_568;
export const SPEECH_MODEL_SHA256 = '4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795';
export type RecordingAudio = 'none' | 'microphone';
export interface MicrophoneHostPort {
  read(): Promise<MicrophoneReadiness>;
  /** Prepares only this original request's microphone intent, never dispatches capture. */
  prepare(requestId: string): Promise<void>;
  abandonPreparation(requestId: string): void;
}

/** Fixed normal-install resource, selected at launch. No environment discovery,
 * renderer path, download, source rewrite or model load/hash in the RPC loop.
 * Metadata is support only: the Engine child verifies the immutable byte hash. */
export async function speechLaunchResource(profilePath: string) {
  if (!isAbsolute(profilePath) || resolve(profilePath) !== profilePath) throw new TypeError('Invalid private profile');
  const directory = join(profilePath, 'resources');
  const path = join(directory, `${SPEECH_PROFILE}.gguf`);
  try {
    const dir = await lstat(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.()
      || (dir.mode & 0o077) || await realpath(directory) !== directory) return undefined;
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const meta = await file.stat();
      const current = await lstat(path);
      if (!meta.isFile() || meta.nlink !== 1 || meta.size !== SPEECH_MODEL_BYTES
        || (meta.uid !== 0 && meta.uid !== process.getuid?.()) || (meta.mode & 0o022)
        || current.isSymbolicLink() || current.dev !== meta.dev || current.ino !== meta.ino) return undefined;
      return { localSpeech: { profile: SPEECH_PROFILE, modelFile: path } };
    } finally { await file.close(); }
  } catch { return undefined; }
}

/** Session-local action policy. Original audio choice is persisted ONLY by
 * Record's existing immutable SDK intent/mapping, never a second writer. */
export function createMicrophonePolicy(options: {
  resourceConfigured: boolean;
  querySupport(): Promise<boolean>;
  readRetainedAudio(requestId: string): Promise<RecordingAudio | undefined>;
}) {
  let phase: 'open' | 'checking-close' | 'closed' = 'open';
  let closeFlight: Promise<boolean> | undefined;
  let supportFlight: Promise<boolean> | undefined;
  let preparing = 0;
  const prepared = new Set<string>();
  const flights = new Map<string, { mode?: RecordingAudio; result: Promise<CommandResult> }>();
  const requireOpen = () => { if (phase !== 'open') throw new Error('Microphone admission closed'); };
  const support = async () => {
    requireOpen();
    if (!options.resourceConfigured) return false;
    supportFlight ??= Promise.resolve().then(options.querySupport).then(value => value === true).catch(() => false)
      .finally(() => { supportFlight = undefined; });
    return supportFlight;
  };
  const read = async (): Promise<MicrophoneReadiness> => {
    const ready = await support();
    return { support: phase === 'open' && ready ? 'available' : 'unavailable' };
  };
  const prepare = async (requestId: string) => {
    requireOpen();
    if (!requestId || requestId.length > 128 || preparing >= 8 || prepared.size >= 16 || flights.has(requestId)) throw new Error('Microphone admission busy');
    preparing++;
    try {
      if (!await support()) throw new Error('Microphone recording unavailable');
      const retained = await options.readRetainedAudio(requestId);
      requireOpen();
      if (flights.has(requestId) || retained === 'none') throw new Error('Original recording intent conflict');
      prepared.add(requestId);
    } finally { preparing--; }
  };
  return {
    port: { read, prepare, abandonPreparation(requestId) { if (!flights.has(requestId)) prepared.delete(requestId); } } satisfies MicrophoneHostPort,
    /** Joins exactly one public request before Record discovery/allocation. */
    runStart(requestId: string, dispatch: () => Promise<CommandResult>): Promise<CommandResult> {
      requireOpen();
      const prior = flights.get(requestId); if (prior) return prior.result;
      if (flights.size >= 16) throw new Error('Recording admission busy');
      const selected: RecordingAudio = prepared.has(requestId) ? 'microphone' : 'none';
      const flight = {} as { mode?: RecordingAudio; result: Promise<CommandResult> };
      // Install the request identity before the first async read. A concurrent
      // microphone action cannot alter a start already choosing its intent.
      flight.result = Promise.resolve().then(async () => {
        const retained = await options.readRetainedAudio(requestId);
        requireOpen();
        if (selected === 'microphone' && retained === 'none') throw new Error('Original recording intent conflict');
        flight.mode = retained ?? selected;
        return dispatch();
      }).finally(() => { flights.delete(requestId); prepared.delete(requestId); });
      flights.set(requestId, flight);
      return flight.result;
    },
    audioFor(requestId: string): RecordingAudio {
      const mode = flights.get(requestId)?.mode;
      if (!mode) throw new Error('Original audio intent unavailable');
      return mode;
    },
    idle: () => preparing === 0 && !supportFlight && flights.size === 0,
    closeAdmission() { phase = 'closed'; prepared.clear(); },
    canClose(check: () => Promise<boolean>, commandAdmission: () => 'open' | 'closed'): Promise<boolean> {
      if (closeFlight) return closeFlight;
      if (phase !== 'open' || preparing || supportFlight || flights.size) return Promise.resolve(false);
      // Seal local admission without an await. A positive nonterminal Record
      // preflight refusal may resume it; irreversible/unknown shutdown cannot.
      phase = 'checking-close';
      closeFlight = Promise.resolve().then(check).then(clear => {
        phase = clear || commandAdmission() !== 'open' ? 'closed' : 'open';
        if (phase === 'closed') prepared.clear();
        return clear;
      }).catch(() => { phase = 'closed'; prepared.clear(); return false; }).finally(() => {
        if (phase === 'open') closeFlight = undefined;
      });
      return closeFlight;
    },
  };
}
