import { tokenValid } from "../../main/protocol.ts";
import { createServer } from "node:net";
export async function availablePort() {
  for (let attempt = 0; attempt < 16; attempt++) {
    const value = 45000 + Math.floor(Math.random() * 15000);
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(value, "127.0.0.1", resolve);
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      return value;
    } catch {
      server.close();
    }
  }
  throw new Error("No available test port");
}

export async function until(predicate: () => unknown, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      throw new Error("Synthetic Hermes smoke timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
export async function waitForKey(read: () => Promise<string>) {
  let key = "";
  await until(async () => {
    try {
      key = await read();
      return tokenValid(key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return false;
    }
  });
  return key;
}
