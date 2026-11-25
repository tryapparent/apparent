export type AutoPasteBridge = {
  read(): Promise<boolean>;
  save(enabled: boolean): Promise<boolean>;
  subscribe(callback: (enabled: boolean | null) => void): () => void;
};

type Message = {
  type: "handoff-auto-paste-result" | "handoff-auto-paste-state";
  request?: number;
  enabled: unknown;
};

export class AutoPasteHost {
  private next = 0;
  private pending?: { id: number; settle: (enabled: unknown) => void };

  constructor(private send: (action: object) => void) {}

  bind(bind: (name: string, handle: (...args: unknown[]) => unknown) => void) {
    bind("read", (...args) => {
      if (args.length) throw Error("Invalid Auto paste read");
      return this.request();
    });
    bind("save", (enabled, ...args) => {
      if (args.length || typeof enabled !== "boolean")
        throw Error("Invalid Auto paste change");
      return this.request(enabled);
    });
  }

  private request(enabled?: boolean): Promise<boolean> {
    if (this.pending)
      return Promise.reject(Error("Auto paste request pending"));
    const request = ++this.next;
    return new Promise((resolve, reject) => {
      const settle = (result: unknown) => {
        clearTimeout(timer);
        this.pending = undefined;
        if (typeof result === "boolean") resolve(result);
        else reject(Error("Auto paste preference not confirmed"));
      };
      const timer = setTimeout(() => settle(null), 3500);
      this.pending = { id: request, settle };
      try {
        this.send({ action: "handoff-auto-paste", request, enabled });
      } catch {
        settle(null);
      }
    });
  }

  receive(message: Message, publish: (enabled: boolean | null) => void) {
    if (message.type === "handoff-auto-paste-state") {
      publish(typeof message.enabled === "boolean" ? message.enabled : null);
    } else if (this.pending && message.request === this.pending.id) {
      this.pending.settle(message.enabled);
    }
  }

  reset() {
    this.pending?.settle(null);
  }
}
