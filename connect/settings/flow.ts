import { useMemo, useSyncExternalStore } from "react";
import type {
  ConnectAction,
  ConnectSettings,
} from "../client/typescript/src/account/protocol.ts";
import { startConnect, type ConnectBridge } from "./consent.ts";
export { startConnect, type ConnectBridge } from "./consent.ts";

class ConnectFlow {
  private generation = 0;
  private active = false;
  private opened: string | null = null;
  private owned = false;
  private readPending: Promise<void> | undefined;
  private actionBusy = false;
  private listener: (() => void) | undefined;
  private state: {
    result: ConnectSettings;
    busy: boolean;
    browserFailed: boolean;
  } = {
    result: { status: "disconnected" },
    busy: true,
    browserFailed: false,
  };

  constructor(private readonly bridge: ConnectBridge) {}

  snapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.active = true;
    this.listener = listener;
    void this.read(true);
    const interval = setInterval(() => void this.read(false), 1000);
    return () => {
      this.active = false;
      this.generation += 1;
      this.listener = undefined;
      this.owned = false;
      this.opened = null;
      this.actionBusy = false;
      this.readPending = undefined;
      clearInterval(interval);
      this.bridge.close?.();
    };
  };

  private publish(update: Partial<ConnectFlow["state"]>) {
    this.state = { ...this.state, ...update };
    this.listener?.();
  }

  private async read(first: boolean) {
    if (!this.active || this.readPending || this.actionBusy) return;
    const token = this.generation;
    const current = () => token === this.generation;
    const operation = async () => {
      try {
        const result = await (first && this.bridge.open
          ? this.bridge.open(() => current() && !this.actionBusy)
          : this.bridge.read());
        if (current()) this.publish({ result });
      } catch {
        if (current()) this.publish({ result: { status: "error" } });
      } finally {
        if (current() && !this.actionBusy) this.publish({ busy: false });
      }
    };
    const pending = operation();
    this.readPending = pending;
    await pending;
    if (this.readPending === pending) this.readPending = undefined;
    if (current()) this.openBrowser();
  }

  private openBrowser() {
    const { result, busy } = this.state;
    const uri =
      result.status === "connected" ? result.view.verificationUri : null;
    if (busy || !this.owned || !uri || uri === this.opened) return;
    this.opened = uri;
    void this.request("open-browser");
  }

  request = async (action: ConnectAction | "refresh") => {
    if (!this.active || this.actionBusy) return;
    this.actionBusy = true;
    const token = this.generation;
    const current = () => token === this.generation;
    const browser = action === "open-browser";
    this.publish({
      busy: true,
      ...(action === "connect" || browser ? { browserFailed: false } : {}),
    });
    if (action === "connect") {
      this.owned = true;
      this.opened = null;
    }
    if (action === "cancel" || action === "disable" || action === "disconnect")
      this.owned = false;
    try {
      await this.readPending;
      if (!current()) return;
      const result = await (action === "connect"
        ? startConnect(this.bridge, current)
        : action === "refresh"
          ? this.bridge.read()
          : this.bridge.command(action));
      if (!current()) return;
      if (browser && result.status === "error")
        this.publish({ browserFailed: true });
      else this.publish({ result });
      return result;
    } catch {
      if (current())
        this.publish(
          browser ? { browserFailed: true } : { result: { status: "error" } },
        );
    } finally {
      if (current()) {
        this.actionBusy = false;
        this.publish({ busy: false });
        this.openBrowser();
      }
    }
  };
}

const subscribeInactive = () => () => {};

export function useConnectFlow(bridge: ConnectBridge, active = true) {
  const flow = useMemo(() => new ConnectFlow(bridge), [bridge]);
  const snapshot = useSyncExternalStore(
    active ? flow.subscribe : subscribeInactive,
    flow.snapshot,
  );
  return {
    ...snapshot,
    view:
      snapshot.result.status === "connected" ? snapshot.result.view : undefined,
    request: flow.request,
  };
}
