import { Button } from "@apparent/ui/button";
import { ErrorDialog } from "@apparent/ui/error-dialog";
import { Switch } from "@apparent/ui/switch";
import { useRef, useState, useSyncExternalStore } from "react";
import lily from "../lily.png";
import { FrogSprite } from "../sprite";
import { FrogAccessory, accessoryNames, type Accessory } from "./accessory";
import "./wardrobe.css";

type Action = "equip" | "remove";
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
    !Array.isArray(items) ||
    items.length !== 3
  )
    throw Error("Invalid wardrobe state");

  const expected = Object.keys(accessoryNames);
  let previousThreshold = 0;
  const projected = items.map((item, index): Item => {
    const rawItem = record(item);
    const { id, threshold, action } = rawItem ?? {};
    if (
      id !== expected[index] ||
      typeof threshold !== "number" ||
      !Number.isSafeInteger(threshold) ||
      threshold <= previousThreshold ||
      (action !== "" && action !== "equip" && action !== "remove")
    )
      throw Error("Invalid wardrobe item");
    previousThreshold = threshold;
    return { id: id as Accessory, threshold, action };
  });
  if (count > previousThreshold) throw Error("Invalid wardrobe count");
  return { enabled, count, items: projected };
}

type View = {
  snapshot?: Snapshot;
  loaded: boolean;
  busy: boolean;
  error: boolean;
  unconfirmed: boolean;
};

function controller(bridge: WardrobeBridge) {
  let view: View = {
    loaded: false,
    busy: false,
    error: false,
    unconfirmed: false,
  };
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
      loaded: true,
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

function inactiveSubscription() {
  return () => {};
}

export function FrogWardrobe({
  bridge,
  frogEnabled,
}: {
  bridge: WardrobeBridge;
  frogEnabled: boolean;
}) {
  const [wardrobe] = useState(() => controller(bridge));
  const { snapshot, loaded, busy, error, unconfirmed } = useSyncExternalStore(
    frogEnabled ? wardrobe.subscribe : inactiveSubscription,
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
        <h3 className="settings-preference-label" id="frog-wardrobe-label">
          Frog wardrobe
        </h3>
        {snapshot && (
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
        )}
      </div>
      {!frogEnabled && <p>Turn on Desktop frog to use the wardrobe.</p>}
      {frogEnabled && loaded && !snapshot && !unconfirmed && (
        <p>Finish setup in the welcome tour to unlock the wardrobe.</p>
      )}
      {snapshot && (
        <p id="frog-wardrobe-help">
          Rewards equip automatically when you earn them.
        </p>
      )}
      {snapshot?.enabled && (
        <div className="frog-wardrobe-layout">
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
                  <small>
                    {action
                      ? `${action === "remove" ? "Equipped" : "Unlocked"} · ${threshold}-recording reward`
                      : `${snapshot.count} of ${threshold} recordings saved`}
                  </small>
                </span>
                {action ? (
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
                ) : (
                  <small className="frog-wardrobe-locked">Locked</small>
                )}
              </li>
            ))}
          </ul>
          <figure className="frog-wardrobe-preview">
            <figcaption>Desktop frog</figcaption>
            <div className="frog-wardrobe-preview-art" aria-hidden="true">
              {snapshot.items.some(
                ({ id, action }) => id === "lily-pad" && action === "remove",
              ) ? (
                <span className="frog-wardrobe-preview-flowering">
                  <FrogAccessory item="lily-pad" />
                </span>
              ) : (
                <img className="frog-wardrobe-preview-pad" src={lily} alt="" />
              )}
              <FrogSprite
                wardrobe={snapshot.items
                  .filter(({ action }) => action === "remove")
                  .map(({ id }) => id)}
              />
            </div>
          </figure>
        </div>
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
