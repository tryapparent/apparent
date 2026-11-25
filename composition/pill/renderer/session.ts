import type { PillBridge, PillUpdate, PillView } from "./bridge";
import type { DestinationView } from "../../../handoff/pure/destinations.ts";
import type { BackgroundHandoff } from "../../../record/pill/renderer/pill-view";

interface Snapshot {
  view: PillView | null;
  destination: DestinationView | null;
  background: BackgroundHandoff | null;
  receivedAt: number;
  handoffLoaded: boolean;
  documentReady: boolean;
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
    documentReady: false,
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

  function apply({ view, ...snapshot }: PillUpdate) {
    if (view && state.view && view.revision < state.view.revision) return;
    const reset =
      view && view.revision !== state.view?.revision
        ? { pending: false, error: false, sharing: null }
        : {};
    update({
      ...snapshot,
      ...reset,
      handoffLoaded: true,
      ...(view ? { view, receivedAt: performance.now() } : {}),
    });
  }

  bridge?.subscribe(apply, () => update({ error: true }));

  function subscribe(onChange: () => void) {
    if (!bridge) return () => {};
    notify = onChange;

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
      notify = undefined;
      media.removeEventListener("change", updateMotion);
      window.removeEventListener("keydown", handleKey);
    };
  }

  return { act, subscribe, getSnapshot: () => state };
}
