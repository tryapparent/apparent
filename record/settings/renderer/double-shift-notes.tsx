import { Switch } from "@apparent/ui/switch";

export type DoubleShiftNotesProps = {
  id: string;
  checked: boolean;
  disabled: boolean;
  saving: boolean;
  onCheckedChange: (value: boolean) => void;
};

export function DoubleShiftNotes({
  id,
  checked,
  disabled,
  saving,
  onCheckedChange,
}: DoubleShiftNotesProps) {
  return (
    <section className="agent-preference">
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="double-shift-notes-label">
          Double-tap Shift for notes
        </h2>
        <Switch
          id={id}
          className="agent-switch"
          checked={checked}
          aria-labelledby="double-shift-notes-label"
          aria-describedby="double-shift-notes-help"
          aria-busy={saving}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p id="double-shift-notes-help">
        Use two quick Shift taps in place of Shift-click. Applies to your next
        recording.
      </p>
    </section>
  );
}
