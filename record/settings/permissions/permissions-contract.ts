export const permissionNames = {
  "screen-recording": "Screen Recording",
  microphone: "Microphone",
  accessibility: "Accessibility",
  camera: "Camera",
  "speech-recognition": "Speech Recognition",
} as const;

export type Permission = keyof typeof permissionNames;
export type Repair = "request" | "open-settings" | "copy-input";

export type PermissionRow = {
  permission: Permission;
  status: "granted" | "denied" | "not-determined" | "unavailable";
  required: boolean;
  relaunch: boolean;
  repair: Repair | "none";
};

export type PermissionState = {
  platform: "macos" | "wayland" | "x11";
  rows: PermissionRow[];
};

export type PermissionIntent =
  | { kind: "recheck" | "reopen" }
  | { kind: "repair"; permission: Permission; repair: Repair };

export type PermissionError =
  | "unavailable"
  | "busy"
  | "changed"
  | "failed"
  | "capture-active";

export type PermissionBridge = {
  read(): Promise<PermissionState | undefined>;
  subscribe(listener: (state: PermissionState) => void): () => void;
  act(intent: PermissionIntent): Promise<PermissionError | null>;
};
