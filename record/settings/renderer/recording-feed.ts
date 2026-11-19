import type { RecordingBridge, RecordingState } from "../recording-contract";

export class RecordingFeed {
  private current: RecordingState | "unavailable" | undefined;
  private unsubscribe?: () => void;
  private revision = 0;
  private timeout?: ReturnType<typeof setTimeout>;

  constructor(private bridge: RecordingBridge) {}

  snapshot = () => this.current;

  get connected() {
    return !!this.unsubscribe;
  }

  private notify?: () => void;

  refresh = () => {
    const revision = ++this.revision;
    this.set(undefined);
    this.timeout = setTimeout(() => {
      if (revision === this.revision) this.set("unavailable");
    }, 3500);
    void this.bridge.read().then(
      (state) => {
        if (revision === this.revision && state) this.set(state);
      },
      () => {
        if (revision === this.revision) this.set("unavailable");
      },
    );
  };

  subscribe = (notify: () => void) => {
    this.notify = notify;
    this.unsubscribe = this.bridge.subscribe((state) => {
      ++this.revision;
      this.set(state);
    });
    this.refresh();
    return () => {
      ++this.revision;
      clearTimeout(this.timeout);
      this.unsubscribe?.();
      this.unsubscribe = undefined;
      this.notify = undefined;
    };
  };

  private set(value: typeof this.current) {
    clearTimeout(this.timeout);
    this.current = value;
    this.notify?.();
  }
}

export class RecordingLevelFeed {
  private level = 0;

  constructor(private bridge: RecordingBridge) {}

  snapshot = () => this.level;

  subscribe = (notify: () => void) => {
    const update = (level: number) => {
      const next = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
      if (next !== this.level) {
        this.level = next;
        notify();
      }
    };
    const unsubscribe = this.bridge.subscribeLevel(update);
    const sync = () => {
      const visible = document.visibilityState === "visible";
      if (!visible) update(0);
      void this.bridge.setMeterVisible(visible).catch(() => {});
    };
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      document.removeEventListener("visibilitychange", sync);
      unsubscribe();
      void this.bridge.setMeterVisible(false).catch(() => {});
    };
  };
}
