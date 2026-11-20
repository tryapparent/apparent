import { Switch } from "@apparent/ui/switch";

export type AgentContextPreferenceProps = {
  id: string;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  onCheckedChange: (value: boolean) => void;
};

export function AgentContextPreference({
  id,
  checked,
  disabled,
  saving,
  onCheckedChange,
}: AgentContextPreferenceProps) {
  return (
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="agent-context-label">
          Recording context for agents
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={checked}
          disabled={disabled}
          aria-busy={saving}
          aria-labelledby="agent-context-label"
          aria-describedby="agent-context-help agent-context-limits"
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="agent-context-help">
        Include more detail about clicks, shortcuts, and marks in the handoff.
        Start a new recording to collect extra context.
      </p>
      <p id="agent-context-limits">
        Native control names require macOS Accessibility. Component and source
        details require a local dev page using the Apparent SDK.
      </p>
    </section>
  );
}
