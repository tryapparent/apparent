import { Switch } from "@apparent/ui/switch";

export function SpeakingStyle({
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
        <h2 className="settings-preference-label" id="speaking-style-label">
          Match my speaking style
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={checked}
          disabled={disabled}
          aria-busy={saving}
          aria-labelledby="speaking-style-label"
          aria-describedby="speaking-style-help"
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="speaking-style-help">
        Let agents use earlier transcripts as writing examples when they inspect
        your next encrypted Connect recordings.
      </p>
    </section>
  );
}
