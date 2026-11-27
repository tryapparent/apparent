import { Button } from "@apparent/ui/button";
import { Switch } from "@apparent/ui/switch";
import { bindPreference } from "../../../shared/settings/binding";
import type { RecordingChange, RecordingState } from "../recording-contract";

export function AgentContextPreference({
  context,
  mac,
  pending,
  save,
}: {
  context: RecordingState["context"];
  mac: boolean;
  pending: RecordingChange | undefined;
  save: (change: RecordingChange) => void;
}) {
  const { enabled, access } = context;
  return (
    <>
      <div className="recording-group">
        <div className="recording-row">
          <label htmlFor="recording-agent-context">
            Recording context for agents
          </label>
          <Switch
            id="recording-agent-context"
            className="recording-switch"
            aria-describedby="recording-context-help"
            checked={enabled}
            disabled={!!pending}
            aria-busy={pending?.key === "agentContext" || undefined}
            onCheckedChange={bindPreference(
              "recording",
              "labs.agentContext",
              (value) => save({ key: "agentContext", value }),
            )}
          />
        </div>
      </div>
      <p id="recording-context-help" className="recording-note">
        Label circled objects. Desktop accessibility adds control details and
        browser sites. Explicitly turning this on also allows text from inside
        circles and diagnostics from registered local pages. Applies to your
        next recording.
      </p>
      {enabled && (
        <>
          <p
            id="recording-context-access"
            className="recording-note"
            role="status"
          >
            {access === "enabled"
              ? "Desktop accessibility is on."
              : access === "unavailable"
                ? "Desktop accessibility is unavailable. Circle recognition is still available."
                : mac
                  ? "Allow Apparent in System Settings under Privacy & Security → Accessibility."
                  : "This enables desktop accessibility system-wide. It stays on if you turn off recording context. Some apps may need a restart."}
          </p>
          {(access === "approval_required" || access === "disabled") && (
            <Button
              id="recording-context-enable"
              variant="outline"
              disabled={!!pending}
              aria-describedby="recording-context-access"
              onClick={() => save({ key: "contextAccessibility", value: true })}
            >
              Enable desktop accessibility
            </Button>
          )}
        </>
      )}
    </>
  );
}
