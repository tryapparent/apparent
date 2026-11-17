import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, mkdir, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OnboardingConnectAdapter } from "../src/settings.ts";

test("public onboarding adapter retains native consent, URI validation and cancellation", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "c-"));
  const directory = path.join(home, ".config/apparent/agent-control");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const address = path.join(directory, "capture.sock");
  const sockets = new Set<net.Socket>();
  const commands: unknown[] = [];
  let unsafe = false;
  const uri = "https://example.invalid/approve?code=ABC";
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const request = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        commands.push(request);
        socket.write(
          JSON.stringify({
            connect: {
              phase: "approval",
              title: "Connect",
              status: "Approval needed",
              detail: "Approve in your browser",
              note: "Nothing shared yet",
              server: null,
              verificationUri: uri,
              userCode: "ABC",
              buttons: [
                {
                  command: "open-browser",
                  title: "Open browser",
                  enabled: true,
                },
              ],
            },
            ...(request.command === "open-browser"
              ? { openUri: unsafe ? "https://wrong.invalid/" : uri }
              : {}),
          }) + "\n",
        );
      }
    });
  });
  const adapter = new OnboardingConnectAdapter(home);
  t.after(async () => {
    adapter.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(home, { recursive: true, force: true });
  });
  await new Promise<void>((resolve) => server.listen(address, resolve));
  await chmod(address, 0o600);
  assert.equal((await adapter.request()).status, "connected");
  assert.deepEqual(
    commands.map((value) => (value as { connect: string }).connect),
    ["settings"],
  );
  assert.equal((await adapter.request("open-browser")).openUri, uri);
  unsafe = true;
  assert.equal((await adapter.request("open-browser")).status, "error");
  assert.throws(() => adapter.request("disconnect" as never), /Forbidden/);
  assert.equal(commands.length, 3);
  adapter.close();
  assert.equal((await adapter.request("allow")).status, "error");
  assert.equal(commands.length, 3);
  await chmod(address, 0o666);
  assert.equal((await adapter.request()).status, "error");
  assert.equal(commands.length, 3);
});
