import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Transport } from "../../main/transport.ts";

type Call = { tag: string; payload: Record<string, unknown> };
type RefPage = {
  isRepo: boolean;
  refs: { name: string; isDefault: boolean; isRemote?: boolean }[];
  nextCursor: number | null;
};
type Peer = {
  reads: number;
  project: string;
  computer: unknown;
  worktree: boolean;
  refPages: RefPage[];
  loseReply: boolean;
  calls: Call[];
  accepted: Set<unknown>;
};

const cases = new WeakMap<TestContext, Map<string, Peer>>();

export async function fixture(t: TestContext) {
  let peers = cases.get(t);
  if (!peers) {
    peers = new Map();
    cases.set(t, peers);
    const connections = peers;
    const { get, rpc } = Transport.prototype;
    t.after(() => {
      Transport.prototype.get = get;
      Transport.prototype.rpc = rpc;
    });
    Transport.prototype.get = async function (this: Transport, route: string) {
      assert.ok(route.startsWith("/api/orchestration/shell?"));
      const peer = connections.get(this.config.origin);
      if (!peer) throw Error("Synthetic computer unavailable");
      peer.reads++;
      return {
        projects: [
          {
            id: "p",
            title: peer.project,
            workspaceRoot: "/synthetic/project",
            defaultModelSelection: {
              instanceId: "fixture",
              model: "project-default",
            },
          },
        ],
        threads: [
          {
            id: "thread",
            projectId: "p",
            title: "Chosen thread",
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ],
      };
    };
    Transport.prototype.rpc = async function (
      this: Transport,
      tag: string,
      payload: Record<string, unknown>,
    ) {
      const peer = connections.get(this.config.origin);
      if (!peer) throw Error("Synthetic computer unavailable");
      if (tag === "server.getConfig")
        return {
          environment: { label: peer.computer },
          settings: {
            defaultModelSelection: {
              instanceId: "fixture",
              model: "environment-default",
            },
            defaultRuntimeMode: "auto-accept-edits",
            defaultThreadEnvMode: peer.worktree ? "worktree" : "root",
          },
        };
      if (tag === "vcs.listRefs") {
        const page = peer.refPages.find(
          (_, index) =>
            (index === 0 ? 0 : peer.refPages[index - 1].nextCursor) ===
            payload.cursor,
        );
        assert.ok(page, "Requested an unexpected ref page");
        assert.equal(payload.includeMatchingRemoteRefs, true);
        return page;
      }
      assert.ok(
        tag === "orchestration.launchThread" ||
          tag === "orchestration.dispatchCommand",
      );
      peer.calls.push({ tag, payload });
      peer.accepted.add(payload.commandId);
      if (peer.loseReply) {
        peer.loseReply = false;
        throw Error("Synthetic reply lost");
      }
      return { threadId: payload.threadId };
    };
  }
  const origin = `https://computer-${peers.size + 1}.example`;
  const peer: Peer = {
    reads: 0,
    project: "Project",
    computer: undefined,
    worktree: false,
    refPages: [
      {
        isRepo: true,
        refs: [{ name: "origin/main", isDefault: true, isRemote: true }],
        nextCursor: null,
      },
    ],
    loseReply: false,
    calls: [],
    accepted: new Set(),
  };
  peers.set(origin, peer);
  const home = await mkdtemp(join(tmpdir(), "t3-picker-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const config = join(home, "config.json");
  const save = (enabled?: boolean) =>
    writeFile(
      config,
      JSON.stringify({
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
  return {
    home,
    config,
    origin,
    save,
    calls: peer.calls,
    accepted: peer.accepted,
    get reads() {
      return peer.reads;
    },
    worktree: (...pages: RefPage[]) => {
      peer.worktree = true;
      if (pages.length) peer.refPages = pages;
    },
    lose: () => {
      peer.loseReply = true;
    },
    label: (name: string) => {
      peer.project = name;
    },
    computer: (name: unknown) => {
      peer.computer = name;
    },
  };
}
