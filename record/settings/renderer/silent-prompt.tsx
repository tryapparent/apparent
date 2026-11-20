import { useEffect, useRef, useState } from "react";
import { Button } from "@apparent/ui/button";
import "./silent-prompt.css";

declare global {
  interface Window {
    apparentLipPrompt: {
      ready(): Promise<boolean>;
      begin(): Promise<number>;
      decode(clip: Uint8Array): Promise<string>;
      cancel(): Promise<void>;
      copy(): Promise<void>;
    };
  }
}

type State = "idle" | "checking" | "opening" | "recording" | "reading";
type Capture = { stream?: MediaStream; recorder?: MediaRecorder; timer?: number };

export function SilentPrompt() {
  const [state, setState] = useState<State>("checking");
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef<Capture | undefined>(undefined);
  const preview = useRef<HTMLVideoElement>(null);
  const bridge = window.apparentLipPrompt;
  const actionUnavailable = state !== "idle" && state !== "recording";

  function release(capture: Capture) {
    clearTimeout(capture.timer);
    capture.stream?.getTracks().forEach(track => track.stop());
    if (preview.current) preview.current.srcObject = null;
  }

  function cancel() {
    const capture = active.current;
    active.current = undefined;
    if (capture) release(capture);
    void bridge.cancel().catch(() => {});
  }

  useEffect(() => {
    let mounted = true;
    void bridge.ready().then(value => {
      if (mounted) setReady(value);
    }).catch(() => {}).finally(() => { if (mounted) setState("idle"); });
    return () => { mounted = false; cancel(); };
  }, []);

  async function refresh() {
    setState("checking");
    try { setReady(await bridge.ready()); }
    catch { setReady(false); }
    finally { setState("idle"); }
  }

  async function start() {
    const capture: Capture = {};
    active.current = capture;
    setState("opening");
    setText("");
    setNotice("");
    try {
      const seconds = await bridge.begin();
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
      if (preview.current) preview.current.srcObject = stream;
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
      capture.timer = window.setTimeout(() => stop(), seconds * 1000);
      setState("recording");
    } catch {
      if (active.current !== capture) return;
      cancel();
      setState("idle");
      setNotice("Couldn’t open the camera. Check camera access, close other apps using it, then retry.");
    }
  }

  function stop() {
    const capture = active.current;
    if (!capture || capture.recorder?.state !== "recording") return;
    capture.recorder.stop();
    release(capture);
    setState("reading");
  }

  return (
    <div className="silent-prompt">
      {!ready && <p>The lip-reading model isn’t ready. Install Lipflow in Apparent’s models folder, then check again.</p>}
      <video autoPlay muted playsInline hidden={state !== "recording"} ref={preview} aria-label="Camera preview" />
      <div className="silent-prompt-actions">
        <Button aria-disabled={actionUnavailable} onClick={() => {
          if (actionUnavailable) return;
          if (state === "recording") stop();
          else if (ready) void start();
          else void refresh();
        }}>{state === "recording" ? "Read my lips" : ready ? "Start camera" : "Check model again"}</Button>
        {ready && state !== "idle" && state !== "checking" && <Button variant="secondary" onClick={() => { cancel(); setState("idle"); }}>Cancel</Button>}
        {text && <Button variant="secondary" onClick={async () => {
          try { await bridge.copy(); setNotice("Prompt copied."); }
          catch { setNotice("Couldn’t copy. Select the text to copy it."); }
        }}>Copy prompt</Button>}
      </div>
      <div role="status">
        {state === "opening" && <p>Opening camera…</p>}
        {state === "recording" && <p>Camera on. Silently mouth your prompt, then select Read my lips.</p>}
        {state === "reading" && <p>Reading lips…</p>}
        {text && <p className="silent-prompt-result">{text}</p>}
        {notice && <p>{notice}</p>}
      </div>
    </div>
  );
}
