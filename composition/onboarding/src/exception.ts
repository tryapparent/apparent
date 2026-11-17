import { lstat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type { Failure } from "./reporting.ts";
export async function reportException(
  home: string,
  kind: Failure,
): Promise<void> {
  let socket: net.Socket | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      socket?.destroy();
      resolve();
    }, 500);
  });
  const send = async () => {
    try {
      const directory = path.join(home, ".config/apparent/agent-control");
      const address = path.join(directory, "capture.sock");
      const dir = await lstat(directory),
        entry = await lstat(address);
      const owner = process.geteuid!();
      if (
        !dir.isDirectory() ||
        dir.uid !== owner ||
        (dir.mode & 0o077) !== 0 ||
        !entry.isSocket() ||
        entry.uid !== owner ||
        (entry.mode & 0o777) !== 0o600 ||
        expired
      )
        return;
      await new Promise<void>((resolve) => {
        let size = 0;
        const finish = () => {
          socket?.destroy();
          resolve();
        };
        socket = net.createConnection(address);
        socket.once("connect", () =>
          socket!.write(
            JSON.stringify({
              errorReporting: "exception",
              kind,
              deadline: Number(process.hrtime.bigint() / 1000000n) + 500,
            }) + "\n",
          ),
        );
        socket.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 || chunk.includes(10)) finish();
        });
        socket.once("error", finish);
        socket.once("end", finish);
      });
    } catch {}
  };
  try {
    await Promise.race([send(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
