import type { PillBridge, PillView } from "./bridge";
import type { DestinationView } from "../../../handoff/pure/destinations.ts";
import type { BackgroundHandoff } from "../../../record/pill/renderer/pill-view";

interface Snapshot {
  view: PillView | null;
  destination: DestinationView | null;
  background: BackgroundHandoff | null;
  receivedAt: number;
  handoffLoaded: boolean;
  systemReduced: boolean;
  sharing: number | null;
  pending: boolean;
  error: boolean;
}

export function createPillSession(bridge: PillBridge | undefined) {
  let state: Snapshot = {
    view: null,
    destination: null,
    background: null,
    receivedAt: 0,
    handoffLoaded: false,
    systemReduced: false,
    sharing: null,
    pending: false,
    error: !bridge,
  };
  let notify: (() => void) | undefined;
  function update(change: Partial<Snapshot>) {
    state = { ...state, ...change };
    notify?.();
  }

  async function act(action: string, drop = false) {
    const revision = state.view?.revision;
    if (!bridge || revision === undefined || state.pending) return;
    update({ pending: true, error: false });
    try {
      const result = await bridge.act(revision, action, drop);
      if (
        (result?.cancelled || result?.confirmationRequired) &&
        state.view?.revision === revision
      ) {
        update({
          pending: false,
          sharing: result.confirmationRequired ? revision : null,
        });
      }
    } catch {
      if (state.view?.revision === revision)
        update({ pending: false, error: true });
    }
  }

  function subscribe(onChange: () => void) {
    if (!bridge) return () => {};
    notify = onChange;
    let active = true;
    function apply(view: PillView | null) {
      if (
        !active ||
        !view ||
        (state.view && view.revision < state.view.revision)
      )
        return;
      const reset =
        view.revision !== state.view?.revision
          ? { pending: false, error: false, sharing: null }
          : {};
      update({ ...reset, view, receivedAt: performance.now() });
    }
    const unsubscribe = bridge.subscribe(apply);
    const unsubscribeDestination = bridge.subscribeDestinations((destination) =>
      update({ destination }),
    );
    const unsubscribeBackground = bridge.subscribeBackgroundHandoff?.(
      (background) => update({ background }),
    );
    void bridge
      .read()
      .then(apply)
      .catch(() => {
        if (active) update({ error: true });
      });
    void Promise.allSettled([
      bridge.destinations().then((destination) => {
        if (active) update({ destination });
      }),
      bridge.backgroundHandoff?.().then((background) => {
        if (active) update({ background });
      }),
    ]).then(() => {
      if (active) update({ handoffLoaded: true });
    });

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => update({ systemReduced: media.matches });
    updateMotion();
    media.addEventListener("change", updateMotion);
    function handleKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (state.sharing !== null) {
        event.preventDefault();
        void act("cancel-public-link");
      } else if (
        state.view?.actions.some(
          (action) => action.id === "cancel" && action.enabled,
        )
      ) {
        event.preventDefault();
        void act("cancel");
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => {
      active = false;
      notify = undefined;
      unsubscribe();
      unsubscribeDestination();
      unsubscribeBackground?.();
      media.removeEventListener("change", updateMotion);
      window.removeEventListener("keydown", handleKey);
    };
  }

  return { act, subscribe, getSnapshot: () => state };
}
