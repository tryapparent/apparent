export {createNativeInkSourcePort} from './client.ts';
import { createHash } from 'node:crypto';

/** Trusted native-source seam. Not renderer data, a source factory, or availability. */
export const NATIVE_INK_LIMITS = Object.freeze({ wireBytes: 65_536, batchBytes: 16_384, batches: 4_096, finishMs: 2_000 });
export interface NativeInkRectangle { x: number; y: number; width: number; height: number }
export interface NativeInkSurface {
  surfaceId: string; transformId: string; nativeIncarnation: string;
  target: 'capture-rectangle' | 'whiteboard-canvas'; pointSpace: 'desktop-physical' | 'paper-logical';
  contentRectangle: NativeInkRectangle; plane: { width: number; height: number };
}
export interface NativeInkObservation {
  host: { processEpoch: string; revision: number; pid: number; startTicks: string };
  producerId: string; generation: number; bootId: string; clock: 'linux-clock-monotonic-observation';
  output: { name: string; physical: NativeInkRectangle; compositor: NativeInkRectangle & { scale: 1 } };
  surfaces: NativeInkSurface[];
}
export interface NativeInkBinding { captureId: string; producerId: string; generation: number }
export interface NativeInkBatch { sequence: number; eventsJson: string; batchSha256: string }
export interface NativeInkSeal {
  finalSequence: number | null;
  seal: { state: 'sealed-and-drained'; observedAtNs: string; nativeRevision: number };
}
export type NativeBoardIntent = 'open' | 'undo' | 'clear' | 'close';
export interface NativeBoardState { nativeRevision: number; open: boolean; strokeCount: number; activeGesture: boolean }
/** Native retains exact bytes until this exact digest is acknowledged. Unknown is terminal for this relay. */
export interface NativeInkSourcePort {
  /** Observation/binding alone must leave native input admission closed. */
  readObservation(): Promise<{ captureId: string; source: { id: string; generation: string }; observation: NativeInkObservation }>;
  /** Open input only after matching Engine registration; recheck native boot/clock and binding. */
  activateInput(binding: NativeInkBinding, clock: { bootId: string; admissionMonotonicNs: string }): Promise<
    { status: 'active' } | { status: 'refused' | 'outcome-unknown' }>;
  readBatch(binding: NativeInkBinding, sequence: number): Promise<
    { status: 'batch'; batch: NativeInkBatch } | { status: 'pending' } | { status: 'unavailable' }>;
  acknowledgeBatch(binding: NativeInkBinding, batch: Pick<NativeInkBatch, 'sequence' | 'batchSha256'>): Promise<
    { status: 'acknowledged'; sequence: number; batchSha256: string } | { status: 'outcome-unknown' }>;
  /** Seal callback admission, resolve active gesture, drain callbacks into retained batches; do not erase them. */
  sealInputAndDrain(binding: NativeInkBinding, timeoutMs?: number): Promise<NativeInkSeal>;
  /** Optional on older native sources. These are native effects, never point ingress. */
  readBoard?(binding: NativeInkBinding, timeoutMs?: number): Promise<NativeBoardState>;
  controlBoard?(binding: NativeInkBinding, intent: NativeBoardIntent, expectedNativeRevision: number, timeoutMs?: number): Promise<'requested' | 'refused' | 'outcome-unknown'>;
}
interface InkAuthority { ingressVersion: 1; ownerToken: string; captureId: string; registrationId: string; producerToken: string }
/** Structural view of committed Engine aa17795f CaptureInkPort; no SDK implementation imported. */
export interface NativeInkSink {
  registerInkProducer(input: { ingressVersion: 1; ownerToken: string; captureId: string;
    source: { id: string; generation: string }; observation: NativeInkObservation }, timeoutMs?: number): Promise<{
      ingressVersion: 1; captureId: string; producerId: string; generation: number; registrationId: string;
      producerToken: string; nextSequence: number;
      clock: { kind: 'linux-clock-monotonic-observation'; bootId: string; admissionMonotonicNs: string };
      limits: { maxWireBytes: number; maxBatchJsonBytes: number; maxPointsPerBatch: number; maxPointsPerGesture: number;
        maxBatches: number; maxSurfaces: number; maxGestures: number; maxTotalPoints: number; maxFactBytes: number; finishGraceMs: number };
    }>;
  submitInkEvents(input: InkAuthority & NativeInkBatch, timeoutMs?: number): Promise<{
    ingressVersion: 1; captureId: string; registrationId: string; sequence: number; batchSha256: string;
    nextSequence: number; outcome: 'accepted' | 'replayed' }>;
  finishInkProducer(input: InkAuthority & NativeInkSeal, timeoutMs?: number): Promise<{
    ingressVersion: 1; captureId: string; registrationId: string; finalSequence: number | null; state: 'complete' | 'unavailable' }>;
}
export type NativeInkRelayPhase = 'unregistered' | 'registering' | 'ready' | 'draining' | 'complete' | 'unavailable';
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const ns = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value) <= 18_446_744_073_709_551_615n;
function ensure(value: unknown): asserts value { if (!value) throw new Error('Native ink collection unavailable'); }
function wire(value: unknown) { ensure(Buffer.byteLength(JSON.stringify(value), 'utf8') <= NATIVE_INK_LIMITS.wireBytes); }
const clone = <T>(value: T): T => structuredClone(value);

/** Privileged forwarding only. The caller must independently join the owned native process/socket.
 * A failure latches unavailable; no automatic re-registration, replay, rebind, or ownership clearance.
 * Call finish concurrently with video Stop, never as a prerequisite for dispatching Stop. */
export function createNativeInkRelay(options: {
  source: NativeInkSourcePort; sink: NativeInkSink;
  original: { captureId: string; source: { id: string; generation: string }; ownerToken: string };
  ownedHost: NativeInkObservation['host'];
}) {
  const original = clone(options.original), owned = clone(options.ownedHost);
  let phase: NativeInkRelayPhase = 'unregistered';
  let authority: InkAuthority | undefined, binding: NativeInkBinding | undefined;
  let sequence = 0, busy = false;
  let inFlight: Promise<void> | undefined;
  const now = () => performance.now();
  async function bounded<T>(call: () => Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - now(); ensure(remaining > 0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([Promise.resolve().then(call), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Native ink deadline expired')), remaining);
      })]);
      ensure(now() < deadline); return value;
    } finally { if (timer) clearTimeout(timer); }
  }
  async function exclusive<T>(expected: NativeInkRelayPhase, next: NativeInkRelayPhase, body: () => Promise<T>): Promise<T> {
    ensure(!busy && phase === expected); busy = true; phase = next;
    let settle!:()=>void;inFlight=new Promise<void>(resolve=>{settle=resolve;});
    try { return await body(); }
    catch (error) { phase = 'unavailable'; throw error; }
    finally { busy = false; settle(); }
  }
  async function forward(deadline: number): Promise<boolean> {
    ensure(authority && binding && sequence < NATIVE_INK_LIMITS.batches);
    const result = await bounded(() => options.source.readBatch(binding!, sequence), deadline);
    if (result.status === 'pending') return false;
    ensure(result.status === 'batch');
    const batch = clone(result.batch);
    ensure(batch.sequence === sequence && typeof batch.eventsJson === 'string'
      && Buffer.byteLength(batch.eventsJson, 'utf8') <= NATIVE_INK_LIMITS.batchBytes
      && /^[a-f0-9]{64}$/.test(batch.batchSha256)
      && Buffer.from(batch.eventsJson, 'utf8').toString('utf8') === batch.eventsJson
      && createHash('sha256').update(batch.eventsJson, 'utf8').digest('hex') === batch.batchSha256);
    // Validate framing only. Native observations/Engine strict parser own event semantics.
    const events: unknown = JSON.parse(batch.eventsJson); ensure(Array.isArray(events) && events.length > 0);
    const input = { ...authority, sequence: batch.sequence, eventsJson: batch.eventsJson, batchSha256: batch.batchSha256 }; wire(input);
    const receipt = await bounded(() => options.sink.submitInkEvents(input, Math.max(1, Math.floor(deadline - now()))), deadline);
    ensure(receipt.ingressVersion === 1 && receipt.captureId === original.captureId
      && receipt.registrationId === authority.registrationId && receipt.sequence === sequence
      && receipt.batchSha256 === batch.batchSha256 && receipt.nextSequence === sequence + 1
      && (receipt.outcome === 'accepted' || receipt.outcome === 'replayed'));
    const ack = await bounded(() => options.source.acknowledgeBatch(binding!, { sequence, batchSha256: batch.batchSha256 }), deadline);
    ensure(ack.status === 'acknowledged' && ack.sequence === sequence && ack.batchSha256 === batch.batchSha256);
    sequence++; return true;
  }
  return {
    phase: (): NativeInkRelayPhase => phase,
    async readBoard() {
      ensure(phase==='ready' && binding && options.source.readBoard);
      return options.source.readBoard(binding!);
    },
    async controlBoard(intent:NativeBoardIntent) {
      ensure(phase==='ready' && binding && options.source.readBoard && options.source.controlBoard);
      const state=await options.source.readBoard(binding!);
      ensure(phase==='ready');
      return options.source.controlBoard(binding!,intent,state.nativeRevision);
    },
    register() { return exclusive('unregistered', 'registering', async () => {
      const deadline = now() + NATIVE_INK_LIMITS.finishMs;
      ensure(id(original.captureId) && original.ownerToken.length > 0 && original.ownerToken.length <= 4096);
      const observed = clone(await bounded(() => options.source.readObservation(), deadline));
      ensure(observed.captureId === original.captureId && observed.source.id === original.source.id
        && observed.source.generation === original.source.generation);
      const o = observed.observation;
      ensure(o.host.processEpoch === owned.processEpoch && o.host.revision === owned.revision && o.host.pid === owned.pid
        && o.host.startTicks === owned.startTicks && owned.processEpoch.length > 0 && uint(owned.revision)
        && uint(owned.pid) && owned.pid > 0 && ns(owned.startTicks)
        && id(o.producerId) && uint(o.generation) && o.clock === 'linux-clock-monotonic-observation'
        && typeof o.bootId === 'string' && o.bootId.length > 0 && o.output.compositor.scale === 1
        && o.surfaces.length > 0 && o.surfaces.length <= 8);
      const input = { ingressVersion: 1 as const, ownerToken: original.ownerToken, captureId: original.captureId,
        source: observed.source, observation: o }; wire(input);
      const receipt = await bounded(() => options.sink.registerInkProducer(input, Math.max(1, Math.floor(deadline - now()))), deadline);
      ensure(receipt.ingressVersion === 1 && receipt.captureId === original.captureId && receipt.producerId === o.producerId
        && receipt.generation === o.generation && id(receipt.registrationId) && typeof receipt.producerToken === 'string'
        && receipt.producerToken.length > 0 && receipt.producerToken.length <= 4096 && receipt.nextSequence === 0
        && receipt.clock.kind === o.clock && receipt.clock.bootId === o.bootId && ns(receipt.clock.admissionMonotonicNs));
      ensure(receipt.limits.maxWireBytes === 65_536 && receipt.limits.maxBatchJsonBytes === 16_384
        && receipt.limits.maxBatches === 4096 && receipt.limits.finishGraceMs === 2000
        && receipt.limits.maxPointsPerBatch === 256 && receipt.limits.maxPointsPerGesture === 2400
        && receipt.limits.maxSurfaces === 8 && receipt.limits.maxGestures === 4096
        && receipt.limits.maxTotalPoints === 65536 && receipt.limits.maxFactBytes === 4194304);
      authority = { ingressVersion: 1, ownerToken: original.ownerToken, captureId: original.captureId,
        registrationId: receipt.registrationId, producerToken: receipt.producerToken };
      binding = { captureId: original.captureId, producerId: o.producerId, generation: o.generation };
      const active = await bounded(() => options.source.activateInput(binding!, {
        bootId: receipt.clock.bootId, admissionMonotonicNs: receipt.clock.admissionMonotonicNs,
      }), deadline);
      ensure(active.status === 'active');
      phase = 'ready';
    }); },
    forwardNext() { return exclusive('ready', 'ready', () => forward(now() + NATIVE_INK_LIMITS.finishMs)); },
    async finish(timeoutMs:number=NATIVE_INK_LIMITS.finishMs) {
      ensure(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=NATIVE_INK_LIMITS.finishMs);
      ensure(phase==='ready');phase='draining';
      const deadline = now() + timeoutMs;
      try{
      if(busy)await bounded(()=>inFlight!,deadline);
      return await exclusive('draining', 'draining', async () => {
      ensure(authority && binding);
      const seal = clone(await bounded(() => options.source.sealInputAndDrain(binding!,Math.max(1,Math.floor(deadline-now()))), deadline));
      ensure((seal.finalSequence === null || (uint(seal.finalSequence) && seal.finalSequence < NATIVE_INK_LIMITS.batches))
        && seal.seal.state === 'sealed-and-drained' && ns(seal.seal.observedAtNs) && uint(seal.seal.nativeRevision));
      ensure(seal.finalSequence === null ? sequence === 0 : sequence <= seal.finalSequence + 1);
      while (seal.finalSequence !== null && sequence <= seal.finalSequence) ensure(await forward(deadline));
      ensure(seal.finalSequence === (sequence === 0 ? null : sequence - 1));
      const input = { ...authority, ...seal }; wire(input);
      const receipt = await bounded(() => options.sink.finishInkProducer(input, Math.max(1, Math.floor(deadline - now()))), deadline);
      ensure(receipt.ingressVersion === 1 && receipt.captureId === original.captureId && receipt.registrationId === authority.registrationId
        && receipt.finalSequence === seal.finalSequence && receipt.state === 'complete');
      phase = 'complete';
    });
      }catch(error){phase='unavailable';throw error;}
    },
  };
}
