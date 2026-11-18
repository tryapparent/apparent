export const recordingPermissions = {
  macos: {
    silent: ["ScreenRecording", "Accessibility"],
    narrated: ["ScreenRecording", "Microphone", "Accessibility"],
  },
  linux: {
    silent: [],
    narrated: [],
  },
} as const;
