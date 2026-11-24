export function coachCopy(
  practiceStage: string | null,
  platform: "macos" | "linux",
  shortcut: string,
) {
  const content: Record<
    string,
    { title: string; text: string; button?: string; action?: string }
  > = {
    start: { title: "One more time.", text: "" },
    screen: {
      title: "Choose your display.",
      text: "Choose a display in the system sharing dialog.",
    },
    whiteboard: { title: "Open Whiteboard.", text: "" },
    "board-ink": { title: "", text: "" },
    "screen-ink": { title: "Draw on your screen.", text: "" },
    stop: { title: "Finish your capture.", text: "" },
    preparing: { title: "", text: "" },
    copied: {
      title: "Paste into your agent.",
      text: "",
      button: "Done",
      action: "practice-review",
    },
    paste: {
      title: "Paste into your agent.",
      text: "",
      button: "Done",
      action: "practice-review",
    },
    locate: {
      title: "apparent lives here.",
      text:
        platform === "linux"
          ? "Right-click the tray icon. Open Latest Capture."
          : "Click the a in your menu bar, then Open Latest Capture.",
    },
    complete: {
      title: "Feel like customizing more?",
      text:
        platform === "linux"
          ? "Open Settings from apparent’s tray icon."
          : "Open Settings from apparent’s menu bar icon.",
    },
    retry: {
      title: "Try another capture.",
      text: `Press ${shortcut} to start again, then follow the drawing prompts. Your previous capture is saved.`,
    },
    "copy-failed": {
      title: "Saved, but not copied.",
      text: "Your capture is saved. Find it in apparent’s menu.",
      button: "Find saved capture",
      action: "practice-locate",
    },
  };
  return content[practiceStage ?? "start"] ?? content.start;
}
