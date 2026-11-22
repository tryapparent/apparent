import { openLipCamera, recordLipCamera } from "./camera";
import policy from "../../settings/lip-policy.mjs";

export type LipControl =
  | { action: "start"; capture: string; elapsed: number }
  | { action: "finish" | "cancel" | "unavailable"; capture: string };
export type LipStatus = "Opening camera…" | "Lip reading" | "Lip reading unavailable";
export type LipCameraInput = { capture: string; stream: MediaStream };
export interface LipRecordingBridge {
  lipPreview: (capture: string) => Promise<{ trackingModel: Uint8Array; wasm: Uint8Array }>;
  subscribeLip: (callback: (control: LipControl) => void) => () => void;
  lipClip: (capture: string, start: number, end: number, bytes: Uint8Array) => Promise<void>;
  lipFinish: (capture: string, complete: boolean) => Promise<void>;
}

type Recording = {
  id: string;
  elapsed: () => number;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: number;
  stopping: boolean;
  sends: Promise<void>;
};

export function connectLipRecording(bridge: LipRecordingBridge, status: (status: LipStatus | null) => void,
  showCamera: (input: LipCameraInput | null) => void) {
  let current: Recording | undefined;

  function release(recording: Recording) {
    window.clearTimeout(recording.timer);
    recording.stream?.getTracks().forEach(track => track.stop());
    if (current === recording) {
      current = undefined;
      showCamera(null);
    }
  }

  function fail(recording: Recording) {
    if (current !== recording) return;
    release(recording);
    status("Lip reading unavailable");
    void bridge.lipFinish(recording.id, false).catch(() => {});
  }

  function record(recording: Recording, stream: MediaStream) {
    const started = recording.elapsed();
    const recorder = recordLipCamera(stream);
    recording.recorder = recorder;
    recorder.onerror = () => fail(recording);
    recorder.ondataavailable = ({ data }) => {
      if (current !== recording || !data.size) return;
      const ended = recording.elapsed();
      recording.sends = recording.sends.then(async () => {
        await bridge.lipClip(recording.id, started, ended, new Uint8Array(await data.arrayBuffer()));
      });
      void recording.sends.catch(() => fail(recording));
    };
    recorder.onstop = () => {
      if (current !== recording) return;
      if (!recording.stopping) {
        try { record(recording, stream); } catch { fail(recording); }
        return;
      }
      release(recording);
      void recording.sends.then(
        () => bridge.lipFinish(recording.id, true),
        () => bridge.lipFinish(recording.id, false),
      ).catch(() => {});
    };
    recorder.start();
    recording.timer = window.setTimeout(() => recorder.stop(), policy.clip_seconds() * 1000);
  }

  const unsubscribe = bridge.subscribeLip(control => {
    if (control.action === "start") {
      if (current) release(current);
      const started = performance.now();
      const recording: Recording = {
        id: control.capture,
        elapsed: () => Math.round(control.elapsed + performance.now() - started),
        stopping: false,
        sends: Promise.resolve(),
      };
      current = recording;
      status("Opening camera…");
      void openLipCamera().then(stream => {
        if (current !== recording) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        recording.stream = stream;
        stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => fail(recording), { once: true }));
        record(recording, stream);
        showCamera({ capture: recording.id, stream });
        status("Lip reading");
      }).catch(() => fail(recording));
      return;
    }
    if (control.action === "unavailable") {
      if (current?.id === control.capture) release(current);
      status("Lip reading unavailable");
      return;
    }
    status(null);
    const recording = current;
    if (!recording || recording.id !== control.capture) return;
    window.clearTimeout(recording.timer);
    if (control.action === "cancel") {
      release(recording);
    } else if (!recording.recorder) {
      fail(recording);
    } else {
      recording.stopping = true;
      if (recording.recorder.state === "recording") recording.recorder.stop();
    }
  });
  return () => {
    unsubscribe();
    if (current) release(current);
  };
}
