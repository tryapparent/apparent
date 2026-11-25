import { Button } from "@apparent/ui/button";
import { ErrorDialog } from "@apparent/ui/error-dialog";
import { Switch } from "@apparent/ui/switch";
import { useRef, useState, useSyncExternalStore } from "react";
import { FrogAccessory, accessoryNames, type Accessory } from "./accessory";
import "./wardrobe.css";

type Action = "claim" | "equip" | "remove";
type Item = { id: Accessory; threshold: number; action: Action | "" };
type Snapshot = { enabled: boolean; count: number; items: Item[] };
type Receipt = { frogWardrobe?: unknown; error?: string };

export type WardrobeBridge = {
  read(): Promise<Receipt>;
  enable(enabled: boolean): Promise<Receipt>;
  act(intent: { item: Accessory; action: Action }): Promise<Receipt>;
  subscribe(listener: (receipt: Receipt) => void): () => void;
};

const actions: Record<Action, string> = {
  claim: "Claim",
  equip: "Equip",
  remove: "Remove",
};

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
}

function project(value: unknown): Snapshot | undefined {
  const raw = record(value);
  if (!raw) return;
  const { enabled, count, items } = raw;
  if (
    typeof enabled !== "boolean" ||
    typeof count !== "number" ||
    !Number.isInteger(count) ||
    count < 0 ||
    count > 30 ||
    !Array.isArray(items) ||
    items.length !== 3
  )
    throw Error("Invalid wardrobe state");

  const expected = Object.keys(accessoryNames);
  const projected = items.map((item, index): Item => {
    const rawItem = record(item);
    const { id, threshold, action } = rawItem ?? {};
    if (
      id !== expected[index] ||
      threshold !== (index + 1) * 10 ||
      (action !== "" &&
        action !== "claim" &&
        action !== "equip" &&
        action !== "remove")
    )
      throw Error("Invalid wardrobe item");
    return { id: id as Accessory, threshold, action };
  });
  return { enabled, count, items: projected };
}

type View = {
  snapshot?: Snapshot;
  busy: boolean;
  error: boolean;
  unconfirmed: boolean;
};

function controller(bridge: WardrobeBridge) {
  let view: View = { busy: false, error: false, unconfirmed: false };
  let current: (() => void) | undefined;
  let generation = 0;
  const publish = (next: Partial<View>) => {
    view = { ...view, ...next };
    current?.();
  };
  function receive(receipt: Receipt) {
    if (receipt.error) throw Error("Wardrobe state unavailable");
    publish({
      snapshot: project(receipt.frogWardrobe),
      error: false,
      unconfirmed: false,
    });
  }
  async function request(operation: () => Promise<Receipt>) {
    if (view.busy) return;
    const owner = generation;
    publish({ busy: true });
    try {
      const receipt = await operation();
      if (owner === generation) receive(receipt);
    } catch {
      if (owner === generation) publish({ error: true, unconfirmed: true });
    } finally {
      if (owner === generation) publish({ busy: false });
    }
  }
  return {
    view: () => view,
    request,
    dismiss: () => publish({ error: false }),
    subscribe(listener: () => void) {
      current = listener;
      const unsubscribe = bridge.subscribe((receipt) => {
        if (view.busy || receipt.error) return;
        try {
          receive(receipt);
        } catch {
          publish({ unconfirmed: true });
        }
      });
      void request(bridge.read);
      return () => {
        generation += 1;
        current = undefined;
        publish({ busy: false });
        unsubscribe();
      };
    },
  };
}

export function FrogWardrobe({ bridge }: { bridge: WardrobeBridge }) {
  const [wardrobe] = useState(() => controller(bridge));
  const { snapshot, busy, error, unconfirmed } = useSyncExternalStore(
    wardrobe.subscribe,
    wardrobe.view,
  );
  const focus = useRef<HTMLElement | null>(null);
  const restoreFocus = () => {
    if (focus.current?.isConnected && !focus.current.matches(":disabled"))
      focus.current.focus();
    else document.getElementById("frog-wardrobe-switch")?.focus();
  };

  async function request(operation: () => Promise<Receipt>) {
    await wardrobe.request(operation);
    requestAnimationFrame(() => {
      if (
        !wardrobe.view().error &&
        document.activeElement === document.body &&
        focus.current?.isConnected
      )
        restoreFocus();
    });
  }

  if (!snapshot && !error && !unconfirmed) return null;
  const act = (
    event: React.MouseEvent<HTMLElement>,
    operation: () => Promise<Receipt>,
  ) => {
    focus.current = event.currentTarget;
    void request(operation);
  };
  return (
    <section
      className="agent-preference frog-wardrobe"
      aria-labelledby="frog-wardrobe-label"
    >
      <div className="agent-preference-row">
        <h2 className="settings-preference-label" id="frog-wardrobe-label">
          Frog wardrobe
        </h2>
        <Switch
          id="frog-wardrobe-switch"
          className="agent-switch"
          checked={snapshot?.enabled}
          disabled={busy || unconfirmed}
          aria-busy={busy}
          aria-labelledby="frog-wardrobe-label"
          aria-describedby="frog-wardrobe-help"
          onClickCapture={(event) => {
            focus.current = event.currentTarget;
          }}
          onCheckedChange={(enabled) => {
            void request(() => bridge.enable(enabled));
          }}
        />
      </div>
      <p id="frog-wardrobe-help">
        Save recordings to unlock accessories for your frog.
      </p>
      {snapshot?.enabled && (
        <ul className="frog-wardrobe-items" aria-busy={busy}>
          {snapshot.items.map(({ id, threshold, action }) => (
            <li key={id} className="frog-wardrobe-item">
              <span className="frog-wardrobe-art">
                <FrogAccessory item={id} />
              </span>
              <span>
                <span className="frog-wardrobe-item-name">
                  {accessoryNames[id]}
                </span>
                {action !== "claim" && (
                  <small>
                    {action === "remove"
                      ? "Equipped"
                      : action === "equip"
                        ? "Claimed"
                        : `${snapshot.count} of ${threshold} saved`}
                  </small>
                )}
              </span>
              {action && (
                <Button
                  variant="outline"
                  disabled={busy || unconfirmed}
                  aria-label={`${actions[action]} ${accessoryNames[id].toLowerCase()}`}
                  onClick={(event) =>
                    act(event, () => bridge.act({ item: id, action }))
                  }
                >
                  {actions[action]}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {unconfirmed && !error && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={(event) => act(event, bridge.read)}
        >
          Refresh wardrobe
        </Button>
      )}
      <ErrorDialog
        open={error}
        title="Wardrobe change unconfirmed"
        description="Refresh your wardrobe to check what was saved."
        recoveryLabel="Refresh wardrobe"
        busy={busy}
        restoreFocus={restoreFocus}
        onRecover={() => void request(bridge.read)}
        onClose={wardrobe.dismiss}
      />
    </section>
  );
}
