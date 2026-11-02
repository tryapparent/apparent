export type RuntimeState =
  | { status: 'connected'; phase: 'idle' | 'selecting' | 'starting' | 'recording' | 'processing' | 'completed' }
  | { status: 'disconnected' }
  | { status: 'error'; message: string };

declare global {
  interface Window {
    apparent?: {
      pickerUpdaterPreference: (key?: string, value?: boolean | string | null) => Promise<PreferenceResult>;
      readRuntimeState: () => Promise<RuntimeState>;
      readCaptureLocation: () => Promise<CaptureLocation>;
      changeCaptureLocation: () => Promise<CaptureLocation>;
      resetCaptureLocation: () => Promise<CaptureLocation>;
      readRetention: () => Promise<RetentionResult>;
      saveRetention: (preset: string) => Promise<RetentionResult>;
      resetRetention: () => Promise<RetentionResult>;
      readCaptureUsage: () => Promise<UsageResult>;
    };
  }
}

export type LocationSnapshot = {
  savedPath: string | null; effectivePath: string; displayPath: string; custom: boolean;
  source: 'environment' | 'configured' | 'builtin' | 'fallback';
};
export type CaptureLocation =
  | { status: 'connected'; storage: LocationSnapshot }
  | { status: 'disabled' | 'disconnected' | 'incompatible' | 'cancelled' }
  | { status: 'error'; code: string };

type Unavailable = Exclude<CaptureLocation, { status: 'connected' }>;
export type RetentionResult = Unavailable | { status: 'connected'; custom: boolean;
  retention: { preset: string | null; options: { id: string; label: string }[]; note: string } };
export type UsageResult = Unavailable | { status: 'connected';
  usage: { effectivePath: string; displayPath: string; formatted: string } };

export type PreferenceResult = { status: 'connected'; iphone: boolean; preferences: {
  lastCaptureMode: string; savedModeUnavailable: boolean; automaticUpdateChecks: boolean | null; automaticUpdateDownloads: boolean | null;
} } | { status: 'disabled' | 'disconnected' | 'incompatible' | 'cancelled' | 'error'; code?: string };
