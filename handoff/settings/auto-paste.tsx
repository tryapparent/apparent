import { Switch } from "@apparent/ui/switch";
import policy from "../pure/auto-paste-preference.mjs";

export type AutoPasteProps = {
  id: string;
  checked: boolean;
  supported: boolean;
  disabled: boolean;
  saving: boolean;
  onCheckedChange: (value: boolean) => void;
};

export function AutoPaste({
  id,
  checked,
  supported,
  disabled,
  saving,
  onCheckedChange,
}: AutoPasteProps) {
  return (
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2
          className="settings-preference-label"
          id="auto-paste-label"
          tabIndex={-1}
        >
          Auto paste
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={checked}
          aria-labelledby="auto-paste-label"
          aria-describedby={
            supported
              ? "auto-paste-help auto-paste-fallback"
              : "auto-paste-help auto-paste-limits auto-paste-fallback"
          }
          aria-busy={saving}
          disabled={disabled || !policy.can_toggle(supported, checked)}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="auto-paste-help">
        Keep the same draft field focused from Finish until the draft appears.
        You decide when to send.
      </p>
      {!supported && (
        <p id="auto-paste-limits">
          Auto paste is unavailable on this platform.
        </p>
      )}
      <p id="auto-paste-fallback">
        If automatic paste is unavailable, use Paste on the saved recording.
      </p>
    </section>
  );
}
