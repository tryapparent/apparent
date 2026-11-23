import { Switch } from "@apparent/ui/switch";

export type PushToTalkProps = {
  id: string;
  checked: boolean;
  supported?: boolean;
  disabled: boolean;
  saving: boolean;
  onCheckedChange: (value: boolean) => void;
};

export function PushToTalk({
  id,
  checked,
  supported,
  disabled,
  saving,
  onCheckedChange,
}: PushToTalkProps) {
  return (
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="push-to-talk-label">
          Push to talk
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={checked}
          aria-labelledby="push-to-talk-label"
          aria-describedby={
            supported === false
              ? "push-to-talk-help push-to-talk-availability"
              : "push-to-talk-help push-to-talk-focus"
          }
          aria-busy={saving}
          disabled={disabled || (!supported && !checked)}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="push-to-talk-help">
        Hold the Record shortcut to start recording and release to finish. A
        quick tap still toggles recording.
      </p>
      {supported === false ? (
        <p id="push-to-talk-availability">
          Requires Hyprland on Wayland with Lua dispatchers and input-device
          access.
        </p>
      ) : (
        <p id="push-to-talk-focus">
          With Auto paste on, keep the same field focused until the draft
          appears.
        </p>
      )}
    </section>
  );
}
