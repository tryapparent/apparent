export type Choice = { id: string; title: string; enabled: boolean };

export type RecordingState = {
  platform: "linux" | "macos";
  microphone: {
    selected: string;
    value: string;
    options: Choice[];
    note: string | null;
    meter: string | null;
  };
  transcriber: {
    engine: "apple" | "hex" | "command";
    hexTitle: string;
    hexEnabled: boolean;
    language: string;
    appleLocale: string;
    models: { id: string; title: string; chosen: boolean }[];
    command: string | null;
  };
  speech: {
    state: string;
    locale?: string;
    locales?: string[];
    engine?: string;
    progress: number;
    error?: string;
  };
  lowerPlayback: boolean;
  playbackLevel: number;
  playbackAvailable: boolean;
  videoExport: boolean;
  mediaWarnings: string[];
};

export type RecordingChange = {
  [K in keyof RecordingValues]: { key: K; value: RecordingValues[K] };
}[keyof RecordingValues];

type RecordingValues = {
  microphone: string;
  transcriber: string;
  appleLocale: string;
  hexModel: string;
  hexLanguage: string;
  lowerPlayback: boolean;
  playbackLevel: number;
  videoExport: boolean;
};

export interface RecordingBridge {
  read(): Promise<RecordingState | undefined>;
  subscribe(listener: (state: RecordingState) => void): () => void;
  subscribeLevel(listener: (level: number) => void): () => void;
  setMeterVisible(visible: boolean): Promise<void>;
  save(change: RecordingChange): Promise<void>;
  openVolumeGuide(): Promise<void>;
}
