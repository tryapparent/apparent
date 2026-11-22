import { Switch } from "@apparent/ui/switch";
import ink from "../../pill/renderer/ink/doodle-ink.mjs";

export function PillDoodles({
  id,
  checked,
  disabled,
  saving,
  onCheckedChange,
}: {
  id: string;
  checked: boolean | null | undefined;
  disabled: boolean;
  saving: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  return (
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 id="pill-doodles-label" className="settings-preference-label">
          Recording pill doodles
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={ink.doodles_enabled(checked === false)}
          aria-labelledby="pill-doodles-label"
          aria-describedby="pill-doodles-help"
          aria-busy={saving}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="pill-doodles-help">
        Draw lilac doodles across the recording pill. Applies to the next
        recording.
      </p>
    </section>
  );
}
