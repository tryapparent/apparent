import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
type FixtureSocket = {
  on(event: "message", listener: (bytes: Buffer) => Promise<void>): void;
  readyState: number;
  OPEN: number;
  send(message: string): void;
  close(): void;
};
export type SocketServer = new (options: {
  server: ReturnType<typeof createServer>;
}) => {
  on(
    event: "connection",
    listener: (socket: FixtureSocket, req: IncomingMessage) => void,
  ): void;
  close(): void;
};

export async function receiver(
  t: { after: (fn: () => Promise<void>) => void },
  WebSocketServer: SocketServer,
  scratch = os.tmpdir(),
) {
  const home = await mkdtemp(path.join(scratch, "t3-picker-")),
    config = path.join(home, "config.json");
  let configPaused: Promise<void> | undefined;
  let configReplies = 0,
    reads = 0,
    loseReply = false,
    envMode = "root",
    many = false,
    empty = false,
    projectName = "Project",
    computerName: unknown = undefined;
  const acceptanceMs: number[] = [];
  const calls: { tag: string; payload: Record<string, unknown> }[] = [],
    accepted = new Set<string>();
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer private-test-token");
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/api/orchestration/shell")) {
      reads++;
      assert.equal(req.headers["x-t3-orchestration-protocol"], "2");
      res.end(
        JSON.stringify({
          projects: [
            {
              id: "p",
              title: projectName,
              workspaceRoot: "/synthetic/project",
              defaultModelSelection: {
                instanceId: "fixture",
                model: "project-default",
              },
            },
          ],
          threads: empty
            ? []
            : [
                {
                  id: "thread",
                  projectId: "p",
                  title: "Chosen thread",
                  createdAt: "2026-01-01",
                  updatedAt: "2026-01-01",
                  status: "completed",
                  latestRunId: "inbox",
                  latestRunCompletedAt: "2026-01-02",
                },
                ...(many
                  ? [
                      {
                        id: "review",
                        projectId: "p",
                        title:
                          "Review recording handoff defaults for " +
                          "onboarding, release validation, and packaging across both computers, ".repeat(
                            5,
                          ),
                        createdAt: "2026-02-01",
                        status: "running",
                        latestRunId: "working",
                      },
                      {
                        id: "capture",
                        projectId: "p",
                        title: "VeryLongUnbrokenProjectIdentifier".repeat(9),
                        createdAt: "2025-11-01",
                      },
                      {
                        id: "snoozed",
                        projectId: "p",
                        title: "Tomorrow’s cleanup",
                        createdAt: "2025-10-01",
                        snoozedUntil: "2099-01-01",
                      },
                    ]
                  : []),
                {
                  id: "settled",
                  projectId: "p",
                  title: "Settled onboarding notes",
                  createdAt: "2026-01-01",
                  updatedAt: "2026-01-01",
                  settledOverride: "settled",
                },
              ],
        }),
      );
    } else if (req.url === "/api/auth/websocket-ticket")
      res.end(JSON.stringify({ ticket: "one-use-ticket" }));
    else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket: FixtureSocket, req: IncomingMessage) => {
    assert.ok(req.url);
    assert.equal(
      new URL(req.url, "http://localhost").searchParams.get(
        "orchestrationProtocol",
      ),
      "2",
    );
    socket.on("message", async (bytes: Buffer) => {
      const message = JSON.parse(bytes.toString());
      if (message._tag !== "Request") return;
      const { tag, payload } = message;
      let value: object = {};
      if (tag === "server.getConfig") {
        await configPaused;
        configReplies++;
        value = {
          ...(computerName === undefined
            ? {}
            : {
                environment: {
                  environmentId: "fixture-environment",
                  label: computerName,
                  platform: "linux",
                  serverVersion: "1.0.0",
                  capabilities: {},
                },
              }),
          settings: {
            defaultModelSelection: {
              instanceId: "fixture",
              model: "environment-default",
            },
            defaultRuntimeMode: "auto-accept-edits",
            defaultThreadEnvMode: envMode,
          },
        };
      } else if (tag === "vcs.listRefs")
        value = {
          isRepo: true,
          hasPrimaryRemote: true,
          refs: [{ name: "origin/main", isDefault: true, isRemote: true }],
        };
      else {
        accepted.add(payload.commandId);
        acceptanceMs.push(Number(process.hrtime.bigint()) / 1e6);
        calls.push({ tag, payload });
        if (loseReply) {
          loseReply = false;
          socket.close();
          return;
        }
        value = { threadId: payload.threadId };
      }
      if (socket.readyState === socket.OPEN)
        socket.send(
          JSON.stringify({
            _tag: "Exit",
            requestId: message.id,
            exit: { _tag: "Success", value },
          }),
        );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const save = async (enabled?: boolean) =>
    writeFile(
      config,
      JSON.stringify({
        secret: "unrelated",
        t3: {
          origin,
          token: "private-test-token",
          expiresAt: Date.now() + 3600000,
        },
        ...(enabled === undefined
          ? {}
          : { experiments: { t3DestinationPicker: enabled } }),
      }),
      { mode: 0o600 },
    );
  await save(true);
  t.after(async () => {
    sockets.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await rm(home, { recursive: true, force: true });
  });
  return {
    config,
    home,
    origin,
    delayConfig: () => {
      let resume!: () => void;
      configPaused = new Promise((resolve) => {
        resume = resolve;
      });
      return resume;
    },
    save,
    calls,
    acceptanceMs,
    accepted,
    get configReplies() {
      return configReplies;
    },
    get reads() {
      return reads;
    },
    lose: () => (loseReply = true),
    worktree: () => (envMode = "worktree"),
    many: () => (many = true),
    empty: () => (empty = true),
    label: (name: string) => (projectName = name),
    computer: (name: unknown) => (computerName = name),
  };
}
