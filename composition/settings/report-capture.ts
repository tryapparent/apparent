import { constants } from "node:fs";
import { mkdtemp, open, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { supportTransport } from "../../connect/native-adapter/src/support-report.ts";
import type { CaptureResult, WrittenResult } from "../../handoff/feedback/contract.ts";

type NativeReply = { status: string; bundle_path?: string };
type Native = (operation: "start-report" | "inspect" | "cancel", id: string) => Promise<NativeReply>;

export function settingsReportCapture(
  executable: string | undefined,
  native: Native,
  visibility: (show: boolean) => void,
  submitted: (id: string, event: string) => Promise<WrittenResult>,
) {
  const support = supportTransport(executable);
  let active: { id: string; event: string; bundle?: string; scratch?: string } | undefined;
  let busy = false;

  return {
    available: support.available,
    async start(): Promise<CaptureResult> {
      if (active || busy) return { status: "unavailable" };
      busy = true;
      const session = { id: randomBytes(16).toString("hex"), event: randomUUID() };
      active = session;
      let saved = false;
      try {
        if (!await support.available()) return { status: "unavailable" };
        visibility(false);
        let reply = await native("start-report", session.id);
        const expiry = Date.now() + 60 * 60 * 1000;
        while (["starting", "recording", "processing", "unconfirmed"].includes(reply.status) && Date.now() < expiry) {
          await delay(500);
          reply = await native("inspect", session.id);
        }
        if (reply.status === "cancelled") return { status: "cancelled" };
        if (reply.status !== "saved" || !reply.bundle_path) return { status: "unavailable" };
        const bundle = reply.bundle_path;
        if (!bundle.startsWith("/") || !bundle.endsWith(".apparent") || await realpath(bundle) !== resolve(bundle))
          return { status: "unavailable" };
        active = { ...session, bundle };
        let video: Uint8Array | undefined;
        try {
          const file = await open(join(bundle, "recording.mp4"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const contents = await file.stat();
            if (contents.isFile() && contents.size > 0 && contents.size <= 24 * 1024 * 1024) {
              const bytes = new Uint8Array(contents.size);
              const preview = await file.read(bytes);
              if (preview.bytesRead === contents.size) video = bytes;
            }
          } finally { await file.close(); }
        } catch {}
        saved = true;
        return { status: "saved", video };
      } catch {
        return { status: "unavailable" };
      } finally {
        if (!saved) active = undefined;
        busy = false;
        visibility(true);
      }
    },
    async discard() {
      if (busy) return;
      const scratch = active?.scratch;
      active = undefined;
      if (scratch) await rm(scratch, { recursive: true, force: true });
    },
    async submit(): Promise<WrittenResult> {
      const capture = active;
      if (!capture?.bundle || busy) return "unavailable";
      busy = true;
      try {
        capture.scratch ??= await mkdtemp(join(await realpath(tmpdir()), "apparent-support-"));
        await support.submit(capture.bundle, join(capture.scratch, "report.age"), capture.id);
        const result = await submitted(capture.id, capture.event);
        if (result === "sent") {
          active = undefined;
          await rm(capture.scratch, { recursive: true, force: true }).catch(() => {});
        }
        return result;
      } catch {
        return "unconfirmed";
      } finally {
        busy = false;
      }
    },
  };
}
