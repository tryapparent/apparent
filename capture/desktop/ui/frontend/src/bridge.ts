export type RuntimeState =
  | { status: 'connected'; phase: 'idle' | 'selecting' | 'starting' | 'recording' | 'processing' | 'completed' }
  | { status: 'disconnected' }
  | { status: 'error'; message: string };

declare global {
  interface Window {
    apparent?: {
      readRuntimeState: () => Promise<RuntimeState>;
      readCaptureLocation: () => Promise<CaptureLocation>;
      changeCaptureLocation: () => Promise<CaptureLocation>;
      resetCaptureLocation: () => Promise<CaptureLocation>;
      readErrorReporting: () => Promise<ErrorReporting>;
      setErrorReporting: (enabled: boolean) => Promise<ErrorReporting>;
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

export type ErrorReporting = { status: 'connected'; enabled: boolean } |
  { status: 'disconnected' | 'incompatible' } | { status: 'error'; code: string };
