import type { PermissionBridge, PermissionState } from "./permissions-contract";

export class PermissionsFeed {
  private state?: PermissionState | "unavailable";
  private listener?: () => void;

  constructor(
    private bridge: PermissionBridge,
    private beforePublish: () => void,
  ) {}

  snapshot = () => this.state;

  connected = () => this.listener !== undefined;

  subscribe = (notify: () => void) => {
    this.listener = notify;
    let live = true;
    let loaded = false;
    const timer = setTimeout(() => update("unavailable"), 3500);
    const update = (value: PermissionState | "unavailable") => {
      if (!live) return;
      loaded = true;
      clearTimeout(timer);
      this.beforePublish();
      this.state = value;
      this.listener?.();
    };
    const unsubscribe = this.bridge.subscribe(update);
    void this.bridge.read().then(
      (value) => {
        if (!loaded && value) update(value);
      },
      () => {
        if (!loaded) update("unavailable");
      },
    );
    return () => {
      live = false;
      clearTimeout(timer);
      unsubscribe();
      this.listener = undefined;
    };
  };
}
