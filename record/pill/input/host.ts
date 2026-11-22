import { LipHost, decodeLipClip } from "../../settings/lip-host.ts";
import policy from "../../settings/lip-policy.mjs";

type Control =
  | { action: "start"; capture: string; elapsed: number }
  | { action: "finish" | "cancel"; capture: string };
type Presentation = Control | { action: "unavailable"; capture: string };
type Result =
  | { kind: "clip"; start: number; end: number; text: string }
  | { kind: "done" | "failed" };
type Job = {
  scope: AbortController;
  owner: number;
  camera: boolean;
  queue: Promise<void>;
  pending: number;
  lostClip: boolean;
  lastEnd: number;
  decoder: NonNullable<Awaited<ReturnType<LipHost["openDecoder"]>>>;
};

export class LipRecordingHost {
  private active?: { capture: string; scope: AbortController };
  private jobs = new Map<string, Job>();
  private readonly lip: LipHost;

  constructor(models: string | undefined, private readonly send: (event: object) => void,
    private readonly present: (control: Presentation) => void) {
    this.lip = new LipHost(models);
  }

  allowsCamera(owner: number) {
    const job = this.active && this.jobs.get(this.active.capture);
    return !!job && job.owner === owner && job.camera;
  }

  ownsCamera(owner: number) {
    return Array.from(this.jobs.values()).some(job => job.owner === owner && job.camera);
  }

  async control(input: Control, owner: number) {
    const { capture } = input;
    if (input.action !== "start") {
      const job = this.jobs.get(capture);
      if (this.active?.capture !== capture) return;
      if (!job || input.action === "cancel") {
        this.active.scope.abort();
        this.active = undefined;
        this.end(capture, "failed");
      }
      this.present(input);
      return;
    }
    if (this.active) {
      const previous = this.active.capture;
      this.active.scope.abort();
      this.end(previous, "failed");
      this.present({ capture: previous, action: "cancel" });
    }
    const scope = new AbortController();
    this.active = { capture, scope };
    const decoder = await this.lip.openDecoder();
    if (scope.signal.aborted) return;
    if (!decoder) {
      this.end(capture, "failed");
      this.present({ capture, action: "unavailable" });
      return;
    }
    this.jobs.set(capture, { scope, decoder, owner, camera: true, queue: Promise.resolve(), pending: 0, lostClip: false, lastEnd: 0 });
    this.present(input);
  }

  clip(owner: number, capture: string, start: number, end: number, bytes: Uint8Array) {
    const job = this.jobs.get(capture);
    if (!job || job.owner !== owner || !job.camera) throw Error("Lip recording unavailable");
    if (!policy.queue_clip(job.pending) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
        start < job.lastEnd || end <= start || end - start > 15000 ||
        !(bytes instanceof Uint8Array) || !policy.valid_size(bytes.byteLength)) {
      this.end(capture, "failed");
      this.present({ capture, action: "unavailable" });
      throw Error("Lip clip unavailable");
    }
    job.lastEnd = end;
    job.pending++;
    job.queue = job.queue.then(async () => {
      if (job.scope.signal.aborted) return;
      try {
        const text = await decodeLipClip(job.decoder, bytes, job.scope.signal);
        if (!job.scope.signal.aborted && text) this.result(capture, { kind: "clip", start, end, text });
      } catch {
        job.lostClip = true;
      } finally {
        job.pending--;
      }
    });
  }

  finish(owner: number, capture: string, complete: boolean) {
    const job = this.jobs.get(capture);
    if (!job || job.owner !== owner) return;
    job.camera = false;
    if (this.active?.capture === capture) this.active = undefined;
    void job.queue.then(() => {
      if (this.jobs.has(capture)) this.end(capture, complete && !job.lostClip ? "done" : "failed");
    });
  }

  dispose() {
    this.active?.scope.abort();
    for (const job of this.jobs.values()) job.scope.abort();
    this.jobs.clear();
  }

  private result(capture: string, result: Result) {
    const event = { lipCapture: capture, lipResult: result };
    if (Buffer.byteLength(JSON.stringify(event)) >= 1024) throw Error("Lip result exceeds transport bound");
    this.send(event);
  }

  private end(capture: string, kind: "done" | "failed") {
    this.jobs.get(capture)?.scope.abort();
    this.jobs.delete(capture);
    if (this.active?.capture === capture) this.active = undefined;
    this.result(capture, { kind });
  }
}
