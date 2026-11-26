import { Switch } from "@apparent/ui/switch";

export function VideoTracing({
  id,
  checked,
  disabled,
  saving,
  onCheckedChange,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  onCheckedChange(value: boolean): void;
}) {
  return (
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="video-tracing-label">
          CLI workflow tracing
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={checked}
          disabled={disabled}
          aria-busy={saving}
          aria-labelledby="video-tracing-label"
          aria-describedby="video-tracing-help"
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="video-tracing-help">
        Use <code>apparent trace</code> to time selected video commands. The
        trace stays on this device and contains command names, timing, and
        outcomes.
      </p>
    </section>
  );
}
