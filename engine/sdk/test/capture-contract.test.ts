import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  CaptureClient,
  encodeCaptureRequest,
  validateCaptureRequest,
} from "../src/capture.ts";
import type {
  CaptureRequest,
  CaptureResponse,
  CaptureTransport,
} from "../src/capture.ts";
import { ChildProcessCaptureTransport } from "../src/capture.ts";
import { ReferenceCapturePeer } from "../src/capture-testing.ts";

test("capture/2 is a separate strict channel and reference peer cannot claim native readiness", async () => {
  const peer = new ReferenceCapturePeer();
  const client = new CaptureClient(peer, { allowTestDouble: true });
  const handshake = await client.handshake();
  assert.equal(handshake.readiness, "unavailable");
  assert.equal(handshake.capabilities.displayCapture, false);
  await assert.rejects(
    new CaptureClient(new ReferenceCapturePeer()).handshake(),
    /explicit/,
  );
  const base = {
    channel: "capture",
    protocolVersion: 2,
    clientId: "a".repeat(32),
    rpcId: "b".repeat(32),
    method: "handshake",
  };
  assert.match(encodeCaptureRequest(base), /"channel":"capture"/);
  assert.throws(
    () => validateCaptureRequest({ ...base, unknown: true }),
    /invalid capture\/2 fields/,
  );
  assert.throws(
    () => validateCaptureRequest({ ...base, protocolVersion: 1 }),
    /unsupported/,
  );
  assert.equal((await client.discoverSources()).state, "unavailable");
  await client.close();
});

test("timeouts and late or wrong-version replies cannot resolve a new RPC", async () => {
  await assert.rejects(
    new CaptureClient(new ReferenceCapturePeer("wrong-version"), {
      allowTestDouble: true,
    }).handshake(),
    /envelope/,
  );
  await assert.rejects(
    new CaptureClient(new ReferenceCapturePeer("malformed-late-reply"), {
      allowTestDouble: true,
    }).handshake(),
    /envelope/,
  );
  const peer = new ReferenceCapturePeer("timeout");
  const client = new CaptureClient(peer, { allowTestDouble: true });
  await assert.rejects(client.handshake(10), /timed out/);
  await client.close();
});

test("explicit test scenarios can observe materials-ready and publishing without asserting native evidence", async () => {
  for (const [scenario, state] of [
    ["materials-ready", "materials-ready"],
    ["publishing", "publishing"],
    ["cancelled", "cancelled"],
  ] as const) {
    const client = new CaptureClient(new ReferenceCapturePeer(scenario), {
      allowTestDouble: true,
    });
    await client.handshake();
    const status = await client.inspect({
      ownerToken: "a".repeat(64),
      captureId: "b".repeat(32),
    });
    assert.equal(status.state, state);
    assert.equal(status.publication, undefined);
    if (state === "materials-ready" || state === "publishing")
      assert.equal(status.materials?.key.captureId, "b".repeat(32));
    await client.close();
  }
});

test("test-double handshake cannot return a native Saved receipt", async () => {
  const peer: CaptureTransport = {
    async request(request: CaptureRequest): Promise<CaptureResponse> {
      if (request.method === "handshake")
        return {
          channel: "capture",
          protocolVersion: 2,
          rpcId: request.rpcId,
          result: new ReferenceCapturePeer().handshake,
        };
      return {
        channel: "capture",
        protocolVersion: 2,
        rpcId: request.rpcId,
        result: {
          captureId: request.captureId,
          state: "saved",
          publication: {
            captureId: request.captureId,
            materials: {
              captureId: request.captureId,
              materialsId: "d".repeat(32),
              revision: "a".repeat(64),
            },
            publicationId: "e".repeat(32),
            planSha256: "f".repeat(64),
            bundleId: "take.apparent",
            bundlePath: "/captures/take.apparent",
            artifactVersion: 1,
            artifactProvenance: "native",
            manifestSha256: "1".repeat(64),
            inventorySha256: "2".repeat(64),
          },
        },
      };
    },
    async close() {
      return "already-exited";
    },
  };
  const client = new CaptureClient(peer, { allowTestDouble: true });
  await client.handshake();
  await assert.rejects(
    client.inspect({ ownerToken: "a".repeat(64), captureId: "b".repeat(32) }),
    /cannot provide native Saved provenance/,
  );
  await client.close();
});

test("close distinguishes observed signal exits from signal requests", async () => {
  const makeChild = (exitOnEof: boolean) => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough;
      stdout: PassThrough;
      stderr: PassThrough;
      exitCode: number | null;
      kill: (signal: "SIGTERM" | "SIGKILL") => boolean;
    };
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    const finish = (signal: "SIGTERM" | "SIGKILL" | null) => {
      child.exitCode = 0;
      child.emit("exit", 0, signal);
    };
    child.stdin.end = (() => {
      if (exitOnEof) queueMicrotask(() => finish(null));
      return child.stdin;
    }) as PassThrough["end"];
    child.kill = (signal) => {
      queueMicrotask(() => finish(signal));
      return true;
    };
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  assert.equal(
    await new ChildProcessCaptureTransport(makeChild(true), 10).close(),
    "eof-exited",
  );
  assert.equal(
    await new ChildProcessCaptureTransport(makeChild(false), 10).close(),
    "signal-exited",
  );
});
