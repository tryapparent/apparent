import { Switch } from "@apparent/ui/switch";
import { FrogWardrobe, type WardrobeBridge } from "./wardrobe/wardrobe";

export function DesktopFrogPreference({
  id,
  checked,
  disabled,
  saving,
  onCheckedChange,
  wardrobe,
}: {
  id: string;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  onCheckedChange(value: boolean): void;
  wardrobe?: WardrobeBridge;
}) {
  return (
    <>
      <section className="agent-preference">
        <div className="agent-preference-row">
          <h2 className="settings-preference-label" id="desktop-frog-label">
            Desktop frog
          </h2>
          <Switch
            id={id}
            className="agent-switch"
            checked={checked}
            disabled={disabled}
            aria-labelledby="desktop-frog-label"
            aria-describedby="desktop-frog-help"
            aria-busy={saving}
            onCheckedChange={onCheckedChange}
          />
        </div>
        <p id="desktop-frog-help">
          Name your frog in the welcome tour. It lands on your desktop after you
          finish setup.
        </p>
      </section>
      {checked && wardrobe && <FrogWardrobe bridge={wardrobe} />}
    </>
  );
}
