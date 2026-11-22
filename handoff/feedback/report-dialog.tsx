import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Bug, Monitor, Pencil } from "lucide-react";
import { Button } from "@apparent/ui/button";
import type { FeedbackBridge, WrittenResult } from "./contract";
import "./report-dialog.css";

const failure: Record<Exclude<WrittenResult, "sent">, string> = {
  invalid: "Enter a description of up to 8 KiB.",
  unavailable: "Bug reporting is unavailable in this build.",
  attachment_unavailable: "Could not attach the recording. It stays on this device. You can write a description instead.",
  unconfirmed: "We could not confirm delivery. Retry or keep your draft open.",
};

export function BugReport({ bridge, frog }: { bridge?: FeedbackBridge; frog: string }) {
  const [available, setAvailable] = useState(false);
  const [recordingAvailable, setRecordingAvailable] = useState<boolean>();
  const [view, setView] = useState<"choice" | "recording" | "recorded" | "written" | "receipt" | null>(null);
  const [video, setVideo] = useState<Uint8Array>();
  const [preview, setPreview] = useState<string>();
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const receipt = useRef<HTMLHeadingElement>(null);
  const preferred = useRef<HTMLButtonElement>(null);
  const alternative = useRef<HTMLButtonElement>(null);
  const requestId = useRef<string | undefined>(undefined);
  const title = useId();
  const field = useId();
  const sharing = useId();

  useEffect(() => {
    let active = true;
    bridge?.available().then(value => { if (active) setAvailable(value); }).catch(() => {});
    return () => { active = false; };
  }, [bridge]);

  useEffect(() => {
    if (view && !dialog.current?.open) dialog.current?.showModal();
    if (view === "choice") (preferred.current?.disabled ? alternative.current : preferred.current)?.focus();
    if (view === "written") input.current?.focus();
    if (view === "receipt") receipt.current?.focus();
  }, [view]);

  useEffect(() => {
    if (!video) { setPreview(undefined); return; }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(video)], { type: "video/mp4" }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [video]);

  function open() {
    setView("choice");
    setRecordingAvailable(undefined);
    bridge?.recordingAvailable().then(setRecordingAvailable).catch(() => setRecordingAvailable(false));
  }

  async function start() {
    if (!bridge || sending) return;
    setMessage("");
    setView("recording");
    try {
      const result = await bridge.startRecording();
      if (result.status === "saved") {
        setVideo(result.video);
        setView("recorded");
        return;
      }
      if (result.status !== "cancelled") setMessage("Could not start or finish that recording. Check your recording permissions and try again.");
    } catch {
      setMessage("Could not start or finish that recording. Check your recording permissions and try again.");
    }
    setView("choice");
  }

  function writeInstead() {
    if (view === "recorded") void bridge?.discardRecording().catch(() => {});
    setVideo(undefined);
    setMessage("");
    setView("written");
  }

  function close() {
    if (view === "recorded") void bridge?.discardRecording().catch(() => {});
    setVideo(undefined);
    dialog.current?.close();
    setView(null);
    setMessage("");
    trigger.current?.focus();
  }

  async function submit(send: () => Promise<WrittenResult>) {
    setSending(true);
    setMessage("");
    try {
      const result = await send();
      if (result === "sent") {
        setDescription("");
        setVideo(undefined);
        requestId.current = undefined;
        setView("receipt");
      } else {
        setMessage(failure[result]);
      }
    } catch {
      setMessage(failure.unconfirmed);
    } finally {
      setSending(false);
    }
  }

  function sendWritten(event: FormEvent) {
    event.preventDefault();
    if (!bridge || sending) return;
    const id = requestId.current ?? crypto.randomUUID();
    requestId.current = id;
    void submit(() => bridge.sendWritten(description, id));
  }

  const written = view === "written";
  if (!available) return null;
  return (
    <div className="bug-report">
      <Button ref={trigger} type="button" variant="ghost" aria-haspopup="dialog" onClick={open}>
        <Bug aria-hidden="true" /> Report a bug
      </Button>
      <dialog
        ref={dialog}
        className="bug-report-dialog"
        aria-labelledby={title}
        onCancel={event => { event.preventDefault(); if (!sending && view !== "recording") close(); }}
      >
        {view === "choice" && (
          <>
            <h2 id={title}>Report a bug</h2>
            <div className="bug-report-choices">
              <Button ref={preferred} type="button" variant={recordingAvailable === false ? "outline" : "default"} disabled={recordingAvailable !== true} onClick={start}>
                <Monitor aria-hidden="true" /> Show it with Apparent
              </Button>
              <Button ref={alternative} type="button" variant={recordingAvailable === false ? "default" : "outline"} onClick={writeInstead}>
                <Pencil aria-hidden="true" /> Write a description
              </Button>
            </div>
            {recordingAvailable === false && <p>Sign in to Apparent Connect to send a recording.</p>}
            {message && <p role="alert">{message}</p>}
          </>
        )}
        {view === "recording" && <h2 id={title}>Recording bug report…</h2>}
        {view === "recorded" && (
          <>
            <h2 id={title}>Send bug report?</h2>
            {preview ? <video controls playsInline src={preview} aria-label="Preview your recording" /> : (
              <p>Preview unavailable. The recording is saved on this device.</p>
            )}
            <p>Your capture, including any audio, transcript and interactions, will go to Apparent Support with your app version and OS.</p>
            {message && <p role="alert">{message}</p>}
            <div className="bug-report-actions">
              <Button type="button" disabled={sending} onClick={() => {
                if (bridge && !sending) void submit(() => bridge.sendRecording());
              }}>{sending ? "Sending…" : "Send report"}</Button>
              <Button type="button" variant="outline" disabled={sending} onClick={close}>Cancel</Button>
              <Button type="button" variant="link" className="bug-report-instead" disabled={sending} onClick={writeInstead}>
                Write a description instead
              </Button>
            </div>
          </>
        )}
        {written && (
          <form onSubmit={sendWritten}>
            <h2 id={title}>Write a bug report</h2>
            <label htmlFor={field}>What happened?</label>
            <textarea
              ref={input}
              id={field}
              aria-describedby={sharing}
              value={description}
              required
              maxLength={8192}
              rows={5}
              readOnly={sending}
              onChange={event => {
                requestId.current = undefined;
                setMessage("");
                setDescription(event.target.value);
              }}
            />
            <p id={sharing}>Your description, app version and OS will be shared with the Apparent team.</p>
            {message && <p role="alert">{message}</p>}
            <div className="bug-report-actions">
              <Button type="submit" disabled={sending}>{sending ? "Sending…" : "Send report"}</Button>
              <Button type="button" variant="outline" disabled={sending} onClick={close}>Cancel</Button>
            </div>
          </form>
        )}
        {view === "receipt" && (
          <div className="bug-report-receipt">
            <div>
              <h2 id={title} ref={receipt} tabIndex={-1}>Report submitted</h2>
              <Button type="button" variant="outline" onClick={close}>Back to Settings</Button>
            </div>
            <div className="bug-report-frog">
              <p>Thank you!</p>
              <img src={frog} alt="" width={158} height={119} />
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
