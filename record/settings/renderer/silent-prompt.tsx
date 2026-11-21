import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LipPill } from "../../pill/renderer/lip-pill";
import { LipPreview } from "../../pill/renderer/lip-preview";
import { Button } from "@apparent/ui/button";
import { LoaderCircle } from "lucide-react";
import "./silent-prompt.css";

declare global {
  interface Window {
    apparentLipPrompt: {
      prepare(): Promise<SetupResult>;
      begin(): Promise<{ seconds: number; tailMs: number; trackingModel: Uint8Array; wasm: Uint8Array }>;
      decode(clip: Uint8Array): Promise<string>;
      cancel(): Promise<void>;
      copy(): Promise<void>;
    };
  }
}

type SetupResult = "ready" | "failed" | "unavailable" | "unsupported";

type State = "idle" | "checking" | "opening" | "recording" | "reading";
type Capture = { stream?: MediaStream; recorder?: MediaRecorder; timer?: number; tailMs?: number; preview: AbortController };

export function SilentPrompt() {
  const [state, setState] = useState<State>("checking");
  const [setup, setSetup] = useState<SetupResult>();
  const [attempt, setAttempt] = useState(0);
  const ready = setup === "ready";
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef<Capture | undefined>(undefined);
  const preview = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const popup = useRef<Window | null>(null);
  const [surface, setSurface] = useState<HTMLElement>();
  const [levels, setLevels] = useState<number[] | null>(null);
  const [tail, setTail] = useState(false);
  const bridge = window.apparentLipPrompt;
  const actionUnavailable = state !== "idle" && state !== "recording";

  function release(capture: Capture) {
    clearTimeout(capture.timer);
    capture.preview.abort();
    capture.stream?.getTracks().forEach(track => track.stop());
    if (preview.current) preview.current.srcObject = null;
  }

  function cancel() {
    const capture = active.current;
    active.current = undefined;
    if (capture) release(capture);
    void bridge.cancel().catch(() => {});
  }

  function closePill() {
    cancel();
    popup.current?.close();
    popup.current = null;
    setSurface(undefined);
    setState("idle");
  }

  function openPill() {
    if (popup.current && !popup.current.closed) return true;
    const child = window.open("about:blank", "apparent-silent-prompt");
    if (!child) return false;
    popup.current = child;
    child.document.title = "Silent prompt";
    child.document.documentElement.className = document.documentElement.className;
    child.document.documentElement.style.colorScheme = getComputedStyle(document.documentElement).colorScheme;
    child.document.documentElement.style.background = "transparent";
    child.document.body.style.cssText = "margin:0;background:transparent;";
    for (const sheet of document.querySelectorAll("link[rel=stylesheet], style")) {
      child.document.head.append(sheet.cloneNode(true));
    }
    child.addEventListener("keydown", event => { if (event.key === "Escape") closePill(); });
    child.addEventListener("pagehide", () => {
      if (popup.current === child) {
        popup.current = null;
        cancel();
        setSurface(undefined);
        setState("idle");
      }
    }, { once: true });
    setSurface(child.document.body);
    return true;
  }

  useEffect(() => {
    let mounted = true;
    setState("checking");
    void bridge.prepare().then(
      value => { if (mounted) setSetup(value); },
      () => { if (mounted) setSetup("failed"); },
    ).finally(() => { if (mounted) setState("idle"); });
    return () => { mounted = false; cancel(); popup.current?.close(); popup.current = null; };
  }, [attempt]);

  async function start() {
    if (!openPill()) { setNotice("Couldn’t open the Silent prompts pill. Try again."); return; }
    const capture: Capture = { preview: new AbortController() };
    setLevels(null);
    setTail(false);
    active.current = capture;
    setState("opening");
    setText("");
    setNotice("");
    try {
      const { seconds, tailMs, trackingModel, wasm } = await bridge.begin();
      capture.tailMs = tailMs;
      if (active.current !== capture) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 640, max: 640 }, height: { ideal: 480, max: 480 }, frameRate: { ideal: 25, max: 30 } },
      });
      if (active.current !== capture) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      capture.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (active.current !== capture) return;
          cancel();
          setState("idle");
          setNotice("Camera disconnected. Reconnect it and try again.");
        }, { once: true });
      }
      if (!preview.current || !canvas.current) throw Error("Silent prompt preview unavailable");
      preview.current.srcObject = stream;
      await preview.current.play();
      await LipPreview.start(preview.current, canvas.current, trackingModel, wasm, capture.preview.signal, setLevels, () => {
        if (active.current !== capture) return;
        cancel();
        setState("idle");
        setNotice("Lip tracking stopped. Try again.");
      });
      if (active.current !== capture) return;
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1_000_000 });
      capture.recorder = recorder;
      recorder.ondataavailable = async ({ data }) => {
        if (active.current !== capture) return;
        release(capture);
        setState("reading");
        try {
          const result = await bridge.decode(new Uint8Array(await data.arrayBuffer()));
          if (active.current !== capture) return;
          setText(result);
          if (!result) setNotice("No words recognized. Try facing the camera in good light.");
        } catch {
          if (active.current === capture) setNotice("Couldn’t read your lips. Check Lipflow’s models and try a short, well-lit prompt.");
        } finally {
          if (active.current === capture) {
            cancel();
            setState("idle");
          }
        }
      };
      recorder.onerror = () => {
        if (active.current !== capture) return;
        cancel();
        setState("idle");
        setNotice("Camera recording failed. Try again.");
      };
      recorder.start();
      capture.timer = window.setTimeout(() => stop(false), seconds * 1000);
      setState("recording");
    } catch {
      if (active.current !== capture) return;
      cancel();
      setState("idle");
      setNotice(capture.stream ? "Couldn’t start lip tracking. Try again." : "Couldn’t open the camera. Check camera access and retry.");
    }
  }

  function stop(withTail = true) {
    const capture = active.current;
    if (!capture || capture.recorder?.state !== "recording") return;
    if (withTail) {
      if (!capture.tailMs) return;
      clearTimeout(capture.timer);
      setTail(true);
      capture.timer = window.setTimeout(() => stop(false), capture.tailMs);
      capture.tailMs = undefined;
      return;
    }
    capture.recorder.stop();
    release(capture);
    setState("reading");
  }

  return (
    <div className="silent-prompt">
      {surface && createPortal(<LipPill active={state === "recording"} reading={state === "reading"}
        tail={tail} text={text} notice={notice} levels={levels} video={preview} canvas={canvas}
        finish={() => stop()} cancel={closePill} retry={() => void start()}
        copy={async () => {
          try { await bridge.copy(); setNotice("Prompt copied."); }
          catch { setNotice("Couldn’t copy. Select the text to copy it."); }
        }} />, surface)}
      <div className="silent-prompt-actions">
        {(ready || state === "idle" && (setup === "failed" || setup === "unavailable")) &&
          <Button disabled={!!surface || actionUnavailable} onClick={() => {
            if (ready) void start();
            else setAttempt(attempt + 1);
          }}>{ready ? "Start camera" : "Retry setup"}</Button>}
      </div>
      <div role="status">
        {state === "checking" && (
          <div className="silent-prompt-progress">
            <LoaderCircle className="settings-spin" size={18} aria-hidden="true" />
            <p>Setting up the lip-reading model. Keep Settings open while it downloads.</p>
          </div>
        )}
        {state === "idle" && setup === "failed" && <p>Model setup failed. Check your internet connection and free disk space, then retry.</p>}
        {state === "idle" && setup === "unavailable" && <p>Apparent couldn’t access its models folder. Reopen Settings and retry.</p>}
        {state === "idle" && setup === "unsupported" && <p>Automatic model setup is unavailable on this platform.</p>}
        {!surface && notice && <p>{notice}</p>}
      </div>
    </div>
  );
}
