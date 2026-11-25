import type {
  RecordingChange,
  RecordingState,
} from "../../record/settings/recording-contract";

type ParentMessage =
  | { type: "recording-state"; state: RecordingState }
  | { type: "recording-result"; request: number; ok: boolean }
  | { type: "recording-level"; level: number };

type Hooks = {
  bind(name: string, handle: (...values: unknown[]) => unknown): void;
};

type SettingsWindow = {
  isVisible(): boolean;
  isMinimized(): boolean;
  on(event: string, listener: () => void): void;
  webContents: { send(channel: string, value: unknown): void };
};

export class RecordingHost {
  private state?: RecordingState;
  private window?: SettingsWindow;
  private wantsMeter = false;
  private meterVisible = false;
  private next = 0;
  private pending?: { id: number; finish: (ok: boolean) => void };

  constructor(private send: (action: object) => void) {}

  bind(window: SettingsWindow, hooks: Hooks) {
    this.window = window;
    const updateMeter = () => this.updateMeter(window);
    for (const event of ["show", "hide", "minimize", "restore"]) {
      window.on(event, updateMeter);
    }
    hooks.bind("read", (...args) => {
      if (args.length) throw new Error("Invalid meter read");
      return this.state;
    });
    hooks.bind("save", (change, ...args) => {
      if (args.length) throw new Error("Invalid recording save");
      return this.save(change);
    });
    hooks.bind("meter", (visible, ...args) => {
      if (args.length || typeof visible !== "boolean")
        throw new Error("Invalid meter request");
      this.wantsMeter = visible;
      updateMeter();
    });
  }

  private updateMeter(window: SettingsWindow) {
    const visible =
      this.wantsMeter && window.isVisible() && !window.isMinimized();
    if (visible === this.meterVisible) return;
    this.meterVisible = visible;
    this.send({ action: "recording-meter", visible });
  }

  private save(change: unknown): Promise<void> {
    if (!isChange(change) || !this.state || this.pending) {
      return Promise.reject(new Error("Recording preference unavailable"));
    }
    if (
      (change.key === "lowerPlayback" || change.key === "playbackLevel") &&
      !this.state.playback
    ) {
      return Promise.reject(new Error("Recording preference unavailable"));
    }
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        this.pending = undefined;
        if (ok) resolve();
        else reject(new Error("Recording preference not confirmed"));
      };
      const timer = setTimeout(() => finish(false), 3500);
      this.pending = { id, finish };
      try {
        this.send({ action: "recording-preference", request: id, ...change });
      } catch {
        finish(false);
      }
    });
  }

  receive(message: ParentMessage) {
    switch (message.type) {
      case "recording-state":
        this.state = message.state;
        this.window?.webContents.send(
          "apparent:recording-state",
          message.state,
        );
        break;
      case "recording-result":
        if (this.pending?.id === message.request)
          this.pending.finish(message.ok === true);
        break;
      case "recording-level":
        this.window?.webContents.send(
          "apparent:recording-level",
          message.level,
        );
        break;
    }
  }

  reset() {
    this.state = undefined;
    this.wantsMeter = false;
    this.meterVisible = false;
    this.pending?.finish(false);
  }
}

function isChange(change: unknown): change is RecordingChange {
  if (
    !change ||
    typeof change !== "object" ||
    Object.keys(change).sort().join(",") !== "key,value"
  )
    return false;
  const { key, value } = change as { key: unknown; value: unknown };
  switch (key) {
    case "lowerPlayback":
    case "videoExport":
      return typeof value === "boolean";
    case "playbackLevel":
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= 0 &&
        value <= 100
      );
    case "microphone":
    case "transcriber":
    case "appleLocale":
    case "hexModel":
    case "hexLanguage":
      return typeof value === "string" && value.length <= 4096;
    default:
      return false;
  }
}
