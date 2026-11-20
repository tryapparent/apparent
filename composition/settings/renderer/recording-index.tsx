import { Button } from "@apparent/ui/button";

type RecordingDestination = "General" | "Recording" | "Agents" | "Labs" | "Permissions";

const stages = [
  {
    title: "Setup",
    links: [
      ["Change record shortcut", "General", "general-shortcuts"],
      ["Screen selection", "Labs", "recording-start"],
    ],
  },
  {
    title: "During",
    links: [
      ["Live transcription", "Labs", "local-stream-label"],
      ["How to add notes", "Recording", "recording-notes"],
    ],
  },
  {
    title: "After",
    links: [
      ["Transcription after recording", "Recording", "recording-transcription"],
      ["Send to T3", "Agents", "agent-t3-label"],
      ["Public links", "Labs", "public-sharing-label"],
      ["Auto paste", "Labs", "auto-paste-label"],
      ["Video export", "Recording", "recording-video-export"],
    ],
  },
] as const;

export function RecordingIndex({
  disabled,
  navigate,
}: {
  disabled: boolean;
  navigate: (pane: RecordingDestination, section: string) => Promise<void>;
}) {
  return (
    <nav aria-labelledby="recording-jumps" className="settings-recording-index">
      <div className="settings-recording-index-heading">
        <h2 id="recording-jumps">Jump to</h2>
        <Button
          className="settings-task-link"
          variant="link"
          type="button"
          disabled={disabled}
          onClick={() => void navigate("Permissions", "settings-permissions")}
        >
          Fix permissions
        </Button>
      </div>
      {stages.map(({ title, links }) => (
        <div className="settings-recording-index-row" key={title}>
          <h3>{title}</h3>
          <ul>
            {links.map(([label, pane, section]) => (
              <li key={section}>
                <Button
                  className="settings-task-link"
                  variant="link"
                  type="button"
                  disabled={disabled}
                  onClick={() => void navigate(pane, section)}
                >
                  {label}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
