import { Button } from "@apparent/ui/button";

type RecordingDestination = "General" | "Recording" | "Labs" | "Permissions";

const stages = [
  {
    title: "Before recording",
    links: [
      ["Record shortcut", "General", "general-shortcuts"],
      ["Screen selection", "Labs", "recording-start"],
      ["Fix permissions", "Permissions", "settings-permissions"],
    ],
  },
  {
    title: "Voice & notes",
    links: [
      ["Transcription", "Recording", "recording-transcription"],
      ["Live transcription", "Labs", "local-stream-label"],
      ["Notes gesture", "Labs", "double-shift-notes-label"],
    ],
  },
  {
    title: "Send & export",
    links: [
      ["Send to T3", "Labs", "agent-t3-label"],
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
    <nav
      aria-label="Recording preferences"
      className="settings-recording-index"
    >
      {stages.map(({ title, links }) => (
        <section key={title}>
          <h2>{title}</h2>
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
        </section>
      ))}
    </nav>
  );
}
