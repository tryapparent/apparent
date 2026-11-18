import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  open,
  rename,
  readFile,
  readdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { Job } from "./delivery.ts";
export class Store {
  readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  private file(capture: string) {
    return path.join(
      this.directory,
      createHash("sha256").update(capture).digest("hex") + ".json",
    );
  }
  async save(job: Job) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const dir = await lstat(this.directory);
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.mode & 0o077)
      throw Error("Handoff storage is not private");
    const file = this.file(job.capture),
      tmp = file + "." + randomUUID() + ".tmp";
    let handle;
    try {
      handle = await open(tmp, "wx", 0o600);
      await handle.writeFile(JSON.stringify(job));
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tmp, file);
      const directory = await open(this.directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await handle?.close();
      await unlink(tmp).catch(() => {});
    }
  }
  async load(): Promise<Job[]> {
    const dir = await lstat(this.directory).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      },
    );
    if (!dir) return [];
    if (!dir.isDirectory() || dir.isSymbolicLink() || dir.mode & 0o077)
      throw Error("Handoff storage is not private");
    const entries = await readdir(this.directory).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      },
    );
    const jobs: Job[] = [];
    for (const name of entries.filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
      const file = path.join(this.directory, name),
        stat = await lstat(file);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 2_000_000 ||
        stat.mode & 0o077
      )
        throw Error("Invalid handoff receipt");
      const j = JSON.parse(await readFile(file, "utf8")) as Job;
      if (
        j.version !== 1 ||
        typeof j.capture !== "string" ||
        !Number.isFinite(j.createdAt) ||
        (j.sentAt !== undefined && !Number.isFinite(j.sentAt)) ||
        typeof j.commandId !== "string" ||
        typeof j.messageId !== "string" ||
        !j.target ||
        typeof j.target.threadId !== "string" ||
        typeof j.target.origin !== "string" ||
        typeof j.target.projectId !== "string" ||
        !(j.text === null || typeof j.text === "string") ||
        ![
          "armed",
          "sending",
          "sent",
          "uncertain",
          "error",
          "cancelled",
        ].includes(j.phase) ||
        this.file(j.capture) !== file
      )
        throw Error("Invalid handoff receipt");
      if (j.phase === "sending") j.phase = "uncertain";
      jobs.push(j);
    }
    return jobs.sort((a, b) => a.createdAt - b.createdAt);
  }
}
