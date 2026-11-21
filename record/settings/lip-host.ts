import { execFile } from "node:child_process";
import { access, lstat, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import policy from "./lip-policy.mjs";
import { installLipflow, managedLipflow, trustedPath } from "./lip-install.ts";
import { uvArtifact, weights } from "./lip-artifacts.ts";

const run = promisify(execFile);
type Decoder = { directory: string; program: string; prefix: string[] };

export class LipHost {
  private readonly models?: string;
  private decoder?: Decoder;
  private setup?: { controller: AbortController; done: Promise<void> };
  private trial?: AbortController;
  private camera = false;
  private lastText = "";
  private generation = 0;
  enabled = false;

  constructor(models?: string) {
    if (models && isAbsolute(models)) this.models = models;
  }

  private async installed(managed: boolean): Promise<Decoder | undefined> {
    if (!this.models) return;
    const directory = join(this.models, managed ? "lipflow-managed" : "lipflow");
    const binary = join(directory, ".venv", "bin");
    const program = join(binary, managed ? "python" : "lipflow");
    try {
      await trustedPath(binary);
      const executable = managed ? await realpath(program) : program;
      await trustedPath(executable);
      const file = await lstat(executable);
      if (!file.isFile() || file.uid !== process.getuid?.()) return;
      await access(program, constants.X_OK);
      if (managed) await access(join(directory, managedLipflow), constants.R_OK);
      for (const [name] of weights) await access(join(directory, "models", name), constants.R_OK);
      return { directory, program, prefix: managed ? ["-m", "lipflow"] : [] };
    } catch {
      return;
    }
  }

  async prepare() {
    const existing = this.enabled && (await this.installed(false) ?? await this.installed(true));
    const state = policy.setup_state(this.enabled, !!existing, !!uvArtifact(process.platform, process.arch));
    if (state === 0) return "unavailable";
    if (state === 1) return "ready";
    if (state === 3) return "unsupported";
    const models = this.models;
    if (!models) return "unavailable";
    if (!this.setup) {
      const controller = new AbortController();
      const done = installLipflow(models, controller.signal).finally(() => { this.setup = undefined; });
      this.setup = { controller, done };
    }
    try {
      await this.setup.done;
    } catch {
      return "failed";
    }
    return (await this.installed(true)) ? "ready" : "failed";
  }

  stopSetup() {
    this.setup?.controller.abort();
  }

  allowsCamera() {
    return policy.admit(this.enabled, this.camera);
  }

  async openDecoder() {
    return await this.installed(false) ?? await this.installed(true);
  }

  async begin() {
    const generation = this.generation;
    const decoder = await this.openDecoder();
    if (!decoder || !policy.admit(this.enabled, generation === this.generation && !this.trial && !this.camera))
      throw Error("Silent prompt unavailable");
    const model = await open(join(decoder.directory, "models", "face_landmarker.task"), constants.O_RDONLY | constants.O_NONBLOCK);
    let trackingModel;
    try {
      const info = await model.stat();
      if (!info.isFile() || !policy.valid_size(info.size)) throw Error("Lip tracking model unavailable");
      const buffer = Buffer.alloc(info.size);
      const result = await model.read(buffer);
      if (result.bytesRead !== buffer.length) throw Error("Lip tracking model unavailable");
      trackingModel = buffer;
    } finally {
      await model.close();
    }
    if (!policy.admit(this.enabled, generation === this.generation && !this.camera))
      throw Error("Silent prompt unavailable");
    this.decoder = decoder;
    this.camera = true;
    this.lastText = "";
    return { seconds: policy.clip_seconds(), tailMs: policy.finish_tail_ms(), trackingModel };
  }

  async decode(bytes: unknown) {
    const decoder = this.decoder;
    if (!policy.admit(this.enabled, this.camera && !!decoder) || !decoder ||
        !(bytes instanceof Uint8Array) || !policy.valid_size(bytes.byteLength))
      throw Error("Invalid silent prompt");
    this.camera = false;
    const trial = new AbortController();
    this.trial = trial;
    try {
      this.lastText = await decodeLipClip(decoder, bytes, trial.signal);
      return this.lastText;
    } finally {
      if (this.trial === trial) this.trial = undefined;
    }
  }

  cancel() {
    this.generation++;
    this.decoder = undefined;
    this.camera = false;
    this.trial?.abort();
  }

  textToCopy() {
    if (!this.enabled || !this.lastText) throw Error("Silent prompt unavailable");
    return this.lastText;
  }
}

export async function decodeLipClip(decoder: Decoder, bytes: Uint8Array, signal: AbortSignal) {
  if (!policy.valid_size(bytes.byteLength)) throw Error("Invalid lip clip");
  const scratch = await mkdtemp(join(tmpdir(), "apparent-dev-lip-prompt-"));
  try {
    const clip = join(scratch, "prompt.webm");
    await writeFile(clip, bytes, { mode: 0o600, signal });
    const { stdout } = await run(decoder.program,
      [...decoder.prefix, "file", clip, "--end", String(policy.clip_seconds()), "--cleanup", "none"], {
        cwd: decoder.directory,
        timeout: 90_000,
        maxBuffer: 65536,
        killSignal: "SIGKILL",
        signal,
        env: { ...process.env, HF_HUB_OFFLINE: "1", LIPFLOW_HOME: scratch },
      });
    const match = /^raw:[ \t]*(.*)$/m.exec(stdout);
    if (!match || signal.aborted) throw Error("Silent prompt unavailable");
    return match[1].trim();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
