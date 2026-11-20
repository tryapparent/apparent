import { useCallback, useRef, useState } from "react";
import { Button } from "@apparent/ui/button";
import { Switch } from "@apparent/ui/switch";
import "./preview.css";

export type FrogNudgePreferenceProps = {
  id: string;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  onCheckedChange: (value: boolean) => void;
};

export function FrogNudgePreference({
  id,
  checked,
  disabled,
  saving,
  onCheckedChange,
}: FrogNudgePreferenceProps) {
  const [preview, setPreview] = useState(0);
  const sequence = useRef(0);
  const previewRef = useCallback((image: HTMLImageElement | null) => {
    if (!image) return;
    const timer = setTimeout(() => setPreview(0), 8_000);
    return () => clearTimeout(timer);
  }, []);
  const [status, setStatus] = useState("");
  function togglePreview() {
    setStatus("");
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStatus("Preview is paused while Reduce Motion is on.");
      return;
    }
    setPreview(preview ? 0 : ++sequence.current);
  }

  return (
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="dictation-frog-label">
          Frog after dictation
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={checked}
          disabled={disabled}
          aria-labelledby="dictation-frog-label"
          aria-describedby="dictation-frog-help"
          aria-busy={saving}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="dictation-frog-help">
        In Wispr Flow and Superwhisper, the frog appears after the first session
        and every other session after that.
        Uses microphone activity only. Off by default.
      </p>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={togglePreview}
      >
        {preview ? "Stop preview" : "Preview frog"}
      </Button>
      {!!preview && (
        <div className="dictation-frog-preview">
          <img
            alt="The apparent frog drops down, waves, and retreats"
            src={`./frog-nudge/wave.webp?preview=${preview}`}
            ref={previewRef}
            onError={() => {
              setPreview(0);
              setStatus("The frog preview could not play.");
            }}
          />
        </div>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
