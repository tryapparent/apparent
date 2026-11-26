export type PreferenceValues = {
  "general.launchAtLogin": boolean;
  "general.errorReporting": boolean;
  "general.recordShortcut": Record<string, unknown>;
  "general.pasteShortcut": Record<string, unknown> | null;
  "recording.microphoneEnabled": boolean;
  "recording.microphone": Record<string, unknown>;
  "recording.transcriber": string;
  "recording.hexModel": string;
  "recording.hexLanguage": string;
  "recording.appleLocale": string;
  "recording.lowerPlayback": boolean;
  "recording.playbackLevel": number;
  "labs.autoPasteDraft": boolean;
  "storage.mediaDays": number | null;
  "storage.capturesDir": string;
  "storage.bundleDays": number | null;
  "storage.maximumMb": number;
  "permissions.skipScreenSelection": boolean;
  "agents.t3DestinationPicker": boolean;
  "labs.localStreamingTranscription": boolean;
  "labs.pushToTalk": boolean;
  "labs.recordingPerformance": boolean;
  "labs.agentContext": boolean;
  "labs.speakingStyle": boolean;
  "labs.videoTracing": boolean;
  "labs.onboardingWisprFlow": boolean;
  "labs.dictationFrog": boolean;
  "labs.desktopFrog": boolean;
  "labs.frogWardrobe": boolean;
  "labs.hostedSharing": boolean;
  "about.updateChannel": string;
};

export type RegisteredPreferenceId = keyof PreferenceValues;

export const preferenceLocations = {
  "labs.autoPasteDraft": "handoff",
} as const;
