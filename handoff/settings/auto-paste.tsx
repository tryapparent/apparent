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
          aria-describedby="auto-paste-help auto-paste-limits auto-paste-fallback"
          aria-busy={saving}
          disabled={disabled || !policy.can_toggle(supported, checked)}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="auto-paste-help">
        After processing, Apparent pastes the image and text into the focused
        composer and automatically presses Enter. Your app may reject the
        attachment or leave the message unsent.
      </p>
      <p id="auto-paste-limits">
        {!supported
          ? "Unavailable in this session. Auto paste requires Hyprland on Wayland with Lua dispatchers."
          : "Starting with your next recording on supported Hyprland, keep your composer focused until processing finishes."}
      </p>
      <p id="auto-paste-fallback">
        You can choose Paste on the saved recording and submit it yourself, or
        paste the copied text into your composer.
      </p>
    </section>
  );
}
