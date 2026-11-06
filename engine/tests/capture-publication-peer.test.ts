import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { CaptureClient, CaptureRpcError, launchCaptureEngine, type MaterialsDocument, type SealedFile } from "../sdk/src/capture.ts";

const id = () => randomBytes(16).toString("hex");
const token = () => randomBytes(32).toString("hex");
const binary = process.env.APPARENT_ENGINE_CAPTURE_BIN;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function privateDir(path: string) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function privateFile(path: string, bytes: Uint8Array) {
  writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
}

function seal(root: string, relativePath: string): SealedFile {
  const path = join(root, relativePath);
  const bytes = readFileSync(path);
  const info = statSync(path, { bigint: true });
  return {
    relativePath,
    identity: {
      device: info.dev.toString(),
      inode: info.ino.toString(),
      size: Number(info.size),
      modifiedNs: info.mtimeNs.toString(),
    },
    sha256: hash(bytes),
  };
}

test("SDK JSONL publish stays cancellable and inspectable during native snapshot", { skip: !binary }, async () => {
  const base = mkdtempSync(join(tmpdir(), "apparent-pub-peer-"));
  chmodSync(base, 0o700);
  const runtime = join(base, "runtime");
  const captureRoot = join(runtime, "capture-v2");
  const materialParent = join(captureRoot, "materials");
  const captureId = id();
  const ownerToken = token();
  const materialsId = id();
  const leaseId = id();
  const publicationId = id();
  const bundleId = `capture-${id()}.apparent`;
  const bundlePath = join(base, "bundles", bundleId);
  const materialRoot = join(materialParent, captureId);
  const stagingRoot = join(base, "record-stage", publicationId);
  const oldReadiness = process.env.APPARENT_CAPTURE_TEST_READINESS_UNAVAILABLE;
  const oldDelay = process.env.APPARENT_CAPTURE_TEST_PUBLICATION_COMMIT_DECISION_DELAY_MS;
  let client: CaptureClient | undefined;
  try {
    privateDir(runtime);
    privateDir(captureRoot);
    privateDir(materialParent);
    privateDir(materialRoot);
    privateDir(join(base, "bundles"));
    privateDir(join(base, "record-stage"));
    privateDir(stagingRoot);

    const movieBytes = readFileSync(resolve("engine/core/tests/fixtures/tiny.mp4"));
    privateFile(join(materialRoot, "recording.mp4"), movieBytes);
    const movie = seal(materialRoot, "recording.mp4");
    const payload = {
      schema: "apparent.capture-materials-payload/1",
      identity: { captureId, materialsId },
      bundleId,
      root: materialRoot,
      leaseId,
      clock: { epoch: "capture-admission-monotonic", units: "integer-milliseconds", durationMs: 1, videoOffsetMs: 0 },
      confirmedSource: {
        id: "display:fixture", generation: id(), confirmedAtMs: 1,
        kind: "display", displayId: 1,
        rectangle: { x: 0, y: 0, width: 16, height: 16, scale: 1 },
        confirmation: { kind: "explicit-display", id: id() },
      },
      invocation: { kind: "explicit", invocationId: id(), observedAtMs: 0 },
      files: [movie],
      video: { file: "recording.mp4", width: 16, height: 16, durationMs: 1 },
      facts: {},
      collection: { context: "unavailable", interactions: "unavailable", candidates: "unavailable", transcript: "unavailable", acceptedStrokes: "unavailable" },
      warnings: [],
      safety: { nativeRemoteDelivery: "forbidden", safeForProcessing: true },
    };
    const payloadBytes = Buffer.from(JSON.stringify(payload));
    privateFile(join(materialRoot, "materials.json"), payloadBytes);
    const payloadFile = seal(materialRoot, "materials.json");
    const materials = {
      manifest: {
        schema: "apparent.capture-materials/1",
        key: { captureId, materialsId, revision: payloadFile.sha256 },
        root: materialRoot,
        leaseId,
        payloadFile,
      },
      payload,
    } as MaterialsDocument;

    const frameBytes = readFileSync(resolve("record/test/fixtures/take.apparent/frames/frame-01.png"));
    privateFile(join(stagingRoot, "summary.md"), Buffer.from("# Capture\n"));
    privateFile(join(stagingRoot, "frame.png"), frameBytes);
    privateFile(join(stagingRoot, "contact-sheet.png"), frameBytes);
    privateFile(join(stagingRoot, "large-companion.bin"), Buffer.alloc(32 * 1024 * 1024, 0x41));
    const summary = seal(stagingRoot, "summary.md");
    const frame = seal(stagingRoot, "frame.png");
    const contact = seal(stagingRoot, "contact-sheet.png");
    const companion = seal(stagingRoot, "large-companion.bin");
    const manifest = {
      version: 1,
      id: bundleId,
      createdAtMs: 1,
      durationMs: 1,
      target: { mode: "display", displayId: 1, frame: { x: 0, y: 0, width: 16, height: 16, scale: 1 } },
      transcript: { source: "none", text: "", segments: [] },
      strokes: [], marks: [], events: [],
      keyframes: [{ index: 1, t: 0, reason: "initial", file: "frames/frame-01.png", event: "start" }],
      contactSheet: "contact-sheet.png",
      video: "recording.mp4",
    };
    privateFile(join(stagingRoot, "apparent.json"), Buffer.from(JSON.stringify(manifest)));
    const manifestFile = seal(stagingRoot, "apparent.json");
    const plan = {
      schema: "apparent.bundle-publication/1",
      publicationId,
      materials: materials.manifest.key,
      bundleId,
      stagingRoot,
      destination: { path: bundlePath, mode: "absent" },
      artifactVersion: 1,
      entries: [
        { relativePath: "apparent.json", sha256: manifestFile.sha256, byteLength: manifestFile.identity.size, role: "manifest", input: { kind: "assembled", file: manifestFile } },
        { relativePath: "summary.md", sha256: summary.sha256, byteLength: summary.identity.size, role: "summary", input: { kind: "assembled", file: summary } },
        { relativePath: "frames/frame-01.png", sha256: frame.sha256, byteLength: frame.identity.size, role: "frame", input: { kind: "assembled", file: frame } },
        { relativePath: "contact-sheet.png", sha256: contact.sha256, byteLength: contact.identity.size, role: "contact-sheet", input: { kind: "assembled", file: contact } },
        { relativePath: "recording.mp4", sha256: movie.sha256, byteLength: movie.identity.size, role: "video", input: { kind: "material", relativePath: "recording.mp4" } },
        { relativePath: "companion.bin", sha256: companion.sha256, byteLength: companion.identity.size, role: "companion", input: { kind: "assembled", file: companion } },
      ],
      manifestPath: "apparent.json",
      summaryPath: "summary.md",
      profile: "apparent-bundle/1",
    };
    const planBytes = Buffer.from(JSON.stringify(plan));
    privateFile(join(stagingRoot, "publication-plan.json"), planBytes);
    const planFile = seal(stagingRoot, "publication-plan.json");
    const rootInfo = statSync(materialRoot, { bigint: true });
    privateFile(join(captureRoot, `${captureId}.json`), Buffer.from(JSON.stringify({
      capture_id: captureId,
      owner_token: ownerToken,
      request: { captureId, ownerToken, bundleId, bundlePath },
      state: "materials-ready",
      error: null,
      materials: materials.manifest,
      root: materialRoot,
      materials_id: materialsId,
      lease_id: leaseId,
      root_device: Number(rootInfo.dev),
      root_inode: Number(rootInfo.ino),
      release_phase: null,
      release_movie: movie.identity,
      release_payload: payloadFile.identity,
      partial_movie: null,
      payload_digest: payloadFile.sha256,
      admitted_monotonic_ns: null,
      confirmed_at_ms: null,
      cancel_requested: false,
      publication: null,
    })));

    process.env.APPARENT_CAPTURE_TEST_READINESS_UNAVAILABLE = "1";
    process.env.APPARENT_CAPTURE_TEST_PUBLICATION_COMMIT_DECISION_DELAY_MS = "600";
    client = new CaptureClient(launchCaptureEngine(resolve(binary!), runtime, 3000));
    const hello = await client.handshake(5000);
    assert.equal(hello.readiness, "unavailable");
    assert.equal(hello.capabilities.publication, true);
    assert.equal(hello.capabilities.displayCapture, false);

    const input = {
      ownerToken,
      captureId,
      leaseId,
      publicationId,
      materials,
      planBytes,
      planFile: { stagingRoot, planFile, planSha256: planFile.sha256 },
    };
    const pendingPublish = client.publish(input, 100).then(
      value => ({ value }),
      error => ({ error }),
    );
    const expectation = {
      materials: materials.manifest.key,
      bundleId,
      bundlePath,
      manifestSha256: manifestFile.sha256,
    };
    const timedOut = await pendingPublish;
    assert.ok("error" in timedOut && /operation was not cancelled/.test(String(timedOut.error)));
    let observed;
    const observeUntil = Date.now() + 5000;
    while (Date.now() < observeUntil) {
      try {
        observed = await client.inspectPublication({ ownerToken, captureId, publicationId, planSha256: planFile.sha256, expected: expectation }, 2000);
        if (observed.state === "publishing") break;
      } catch (error) {
        if (!(error instanceof CaptureRpcError) || error.code !== "not_found") throw error;
      }
      await delay(10);
    }
    assert.equal(observed?.state, "publishing", "same-connection inspect must remain live after durable publish intent");
    assert.equal((await client.discoverSources()).state, "unavailable", "other capture controls must remain live during publication work");
    const cancelled = await client.cancel({ ownerToken, captureId }, 3000);
    assert.equal(cancelled.state, "cancelled", "cancellation before the explicit commit decision must win");
    const recovered = await client.inspectPublication({ ownerToken, captureId, publicationId, planSha256: planFile.sha256, expected: expectation }, 3000);
    assert.equal(recovered.state, "cancelled");
    assert.throws(() => statSync(bundlePath), { code: "ENOENT" });
  } finally {
    await client?.close();
    if (oldReadiness === undefined) delete process.env.APPARENT_CAPTURE_TEST_READINESS_UNAVAILABLE;
    else process.env.APPARENT_CAPTURE_TEST_READINESS_UNAVAILABLE = oldReadiness;
    if (oldDelay === undefined) delete process.env.APPARENT_CAPTURE_TEST_PUBLICATION_COMMIT_DECISION_DELAY_MS;
    else process.env.APPARENT_CAPTURE_TEST_PUBLICATION_COMMIT_DECISION_DELAY_MS = oldDelay;
    rmSync(base, { recursive: true, force: true });
  }
});
