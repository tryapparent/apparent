import type { PermissionBridge, PermissionState } from "./permissions-contract";

type Snapshot = {
  facts?: PermissionState;
  phase: "checking" | "ready" | "unavailable";
};

export class PermissionsFeed {
  private state?: Snapshot;
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
    const timer = setTimeout(
      () => update(this.state?.facts, "unavailable"),
      3500,
    );
    const update = (
      facts: PermissionState | undefined,
      phase: Snapshot["phase"],
    ) => {
      if (!live) return;
      loaded = true;
      this.beforePublish();
      this.state = { facts, phase };
      this.listener?.();
    };
    const receive = (value: PermissionState) => {
      if (value.accessChecked) {
        clearTimeout(timer);
        update(value, "ready");
      } else {
        const phase = this.state?.phase;
        update(
          value,
          phase === "ready" || phase === "unavailable"
            ? "unavailable"
            : "checking",
        );
      }
    };
    const unsubscribe = this.bridge.subscribe(receive);
    void this.bridge.read().then(
      (value) => {
        if (!loaded && value) receive(value);
      },
      () => {
        if (!loaded) {
          clearTimeout(timer);
          update(undefined, "unavailable");
        }
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
