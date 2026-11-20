import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import policy from "./lip-policy.mjs";

const run = promisify(execFile);

export class LipHost {
  private directory?: string;
  private trial?: AbortController;
  private camera = false;
  private lastText = "";
  private selection = 0;
  enabled = false;

  allowsCamera() {
    return policy.admit(this.enabled, this.camera);
  }

  begin() {
    if (!policy.admit(this.enabled, !!this.directory && !this.trial && !this.camera))
      throw Error("Silent prompt unavailable");
    this.camera = true;
    this.lastText = "";
    return policy.clip_seconds();
  }

  async select(pick: () => Promise<string | undefined>) {
    if (!this.enabled || this.camera || this.trial) throw Error("Silent prompt unavailable");
    const selection = ++this.selection;
    const directory = await pick();
    if (!directory || selection !== this.selection) return false;
    await access(join(directory, ".venv", "bin", "lipflow"), constants.X_OK);
    if (!this.enabled || selection !== this.selection) return false;
    this.directory = directory;
    return true;
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
    this.selection++;
    this.camera = false;
    this.trial?.abort();
  }

  textToCopy() {
    if (!this.enabled || !this.lastText) throw Error("Silent prompt unavailable");
    return this.lastText;
  }
}
