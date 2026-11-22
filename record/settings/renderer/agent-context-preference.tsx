import { Switch } from "@apparent/ui/switch";

export type AgentContextPreferenceProps = {
  id: string;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  access?: "enabled" | "approval_required" | "disabled" | "unavailable";
  onCheckedChange: (value: boolean) => void;
};

export function AgentContextPreference({
  id,
  checked,
  disabled,
  saving,
  access,
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
          aria-describedby="agent-context-help agent-context-limits agent-context-access"
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="agent-context-help">
        Include more detail about clicks, shortcuts, and marks in the handoff.
        Start a new recording to collect extra context.
      </p>
      <p id="agent-context-limits">
        On Linux, this enables desktop accessibility. It stays on when you turn
        this switch off. Some apps may need a restart. On macOS, approve
        Apparent in System Settings. Component and source details require a
        local dev page using the Apparent SDK.
      </p>
      <p
        id="agent-context-access"
        role="status"
        hidden={!checked || access === undefined || access === "enabled"}
      >
        {access === "approval_required"
          ? "Allow Apparent under Privacy & Security → Accessibility to name controls."
          : access === "disabled" || access === "unavailable"
            ? "Desktop accessibility is off or unavailable. Visual marks still work."
            : null}
      </p>
    </section>
  );
}

export function CircleLabelsPreference({
  id,
  checked,
  disabled,
  saving,
  onCheckedChange,
}: AgentContextPreferenceProps) {
  return (
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="circle-labels-label">
          Label circled items
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={checked}
          disabled={disabled}
          aria-busy={saving}
          aria-labelledby="circle-labels-label"
          aria-describedby="circle-labels-help"
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="circle-labels-help">
        Read English text and recognize objects you circle on screen. Available
        labels appear in the handoff. Runs on this device starting with your
        next recording.
      </p>
    </section>
  );
}
