export const recordingPermissions = {
  macos: {
    silent: ["ScreenRecording", "Accessibility"],
    narrated: ["ScreenRecording", "Microphone", "Accessibility"],
  },
  macosPicker: {
    silent: ["Accessibility"],
    narrated: ["Microphone", "Accessibility"],
  },
  linux: {
    silent: [],
    narrated: [],
  },
} as const;
