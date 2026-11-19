import {
  permissionNames,
  type PermissionError,
  type PermissionIntent,
  type PermissionState,
} from "../../record/settings/permissions/permissions-contract.ts";

export class PermissionHost {
  private state?: PermissionState;
  private next = 0;
  private pending?: {
    request: number;
    finish: (error: PermissionError | null) => void;
  };

  constructor(private send: (action: object) => void) {}

  bind(
    bind: (name: string, handle: (...values: unknown[]) => unknown) => void,
    publish: (state: PermissionState) => void,
  ) {
    this.publish = publish;
    bind("read", (...args) => {
      if (args.length) throw Error("Invalid permission read");
      return this.state;
    });
    bind("act", (intent, ...args) => {
      if (args.length || !isIntent(intent))
        throw Error("Invalid permission action");
      return this.act(intent);
    });
  }

  private publish?: (state: PermissionState) => void;

  private act(intent: PermissionIntent): Promise<PermissionError | null> {
    if (this.pending) return Promise.resolve("busy");
    const request = ++this.next;
    return new Promise((resolve) => {
      const finish = (error: PermissionError | null) => {
        clearTimeout(timer);
        this.pending = undefined;
        resolve(error);
      };
      const timer = setTimeout(() => finish("unavailable"), 4000);
      this.pending = { request, finish };
      try {
        this.send({ action: "permission-action", request, intent });
      } catch {
        finish("failed");
      }
    });
  }

  receive(
    message:
      | { type: "permission-state"; state: PermissionState }
      | {
          type: "permission-result";
          request: number;
          error: PermissionError | null;
        },
  ) {
    if (message.type === "permission-state") {
      this.state = message.state;
      this.publish?.(message.state);
    } else if (
      message.type === "permission-result" &&
      this.pending?.request === message.request
    ) {
      this.pending.finish(message.error);
    }
  }

  reset() {
    this.state = undefined;
    this.pending?.finish("unavailable");
  }
}

function isIntent(value: unknown): value is PermissionIntent {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  if (value.kind === "recheck" || value.kind === "reopen")
    return Object.keys(value).length === 1;
  return (
    value.kind === "repair" &&
    Object.keys(value).length === 3 &&
    "permission" in value &&
    typeof value.permission === "string" &&
    Object.hasOwn(permissionNames, value.permission) &&
    "repair" in value &&
    ["request", "open-settings", "copy-input"].includes(value.repair as string)
  );
}
