import { execFile } from "node:child_process";
import { access, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import policy from "./lip-policy.mjs";

const run = promisify(execFile);

export class LipHost {
  private readonly directory?: string;
  private trial?: AbortController;
  private camera = false;
  private lastText = "";
  private generation = 0;
  enabled = false;

  constructor(models?: string) {
    if (models && isAbsolute(models)) this.directory = join(models, "lipflow");
  }

  async ready() {
    if (!this.enabled || !this.directory) return false;
    const program = join(this.directory, ".venv", "bin", "lipflow");
    try {
      const uid = process.getuid?.();
      for (let path = program; path !== dirname(path); path = dirname(path)) {
        const item = await lstat(path);
        if (item.isSymbolicLink() || (item.uid !== uid && item.uid !== 0) ||
            ((item.mode & 0o022) !== 0 && (!item.isDirectory() || (item.mode & 0o1000) === 0)))
          return false;
        if (path === program && (!item.isFile() || item.uid !== uid)) return false;
      }
      await access(program, constants.X_OK);
      for (const model of ["vsr/model.json", "vsr/model.pth", "lm/model.json", "lm/model.pth", "face_landmarker.task"]) {
        await access(join(this.directory, "models", model), constants.R_OK);
      }
      return true;
    } catch {
      return false;
    }
  }

  allowsCamera() {
    return policy.admit(this.enabled, this.camera);
  }

  async begin() {
    const generation = this.generation;
    const ready = await this.ready();
    if (!policy.admit(this.enabled, ready && generation === this.generation && !this.trial && !this.camera))
      throw Error("Silent prompt unavailable");
    this.camera = true;
    this.lastText = "";
    return policy.clip_seconds();
  }

  async decode(bytes: unknown) {
    const directory = this.directory;
    if (!policy.admit(this.enabled, this.camera && !!directory) || !directory ||
        !(bytes instanceof Uint8Array) || !policy.valid_size(bytes.byteLength))
      throw Error("Invalid silent prompt");
    this.camera = false;
    const trial = new AbortController();
    this.trial = trial;
    let scratch: string | undefined;
    try {
      scratch = await mkdtemp(join(tmpdir(), "apparent-dev-lip-prompt-"));
      const clip = join(scratch, "prompt.webm");
      await writeFile(clip, bytes, { mode: 0o600, signal: trial.signal });
      const { stdout } = await run(join(directory, ".venv", "bin", "lipflow"),
        ["file", clip, "--end", String(policy.clip_seconds()), "--cleanup", "none"], {
          cwd: directory,
          timeout: 90_000,
          maxBuffer: 65536,
          killSignal: "SIGKILL",
          signal: trial.signal,
          env: { ...process.env, HF_HUB_OFFLINE: "1", LIPFLOW_HOME: scratch },
        });
      const match = /^raw:[ \t]*(.*)$/m.exec(stdout);
      if (!match || trial.signal.aborted) throw Error("Silent prompt unavailable");
      this.lastText = match[1].trim();
      return this.lastText;
    } catch {
      throw Error("Lipflow could not read the clip");
    } finally {
      try {
        if (scratch) await rm(scratch, { recursive: true, force: true });
      } finally {
        if (this.trial === trial) this.trial = undefined;
      }
    }
  }

  cancel() {
    this.generation++;
    this.camera = false;
    this.trial?.abort();
  }

  textToCopy() {
    if (!this.enabled || !this.lastText) throw Error("Silent prompt unavailable");
    return this.lastText;
  }
}
