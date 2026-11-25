import type { DestinationView } from "../../../handoff/pure/destinations.ts";
import type { PillView } from "../../../record/pill/renderer/view";
import type { BackgroundHandoff } from "../../../record/pill/renderer/pill-view";
export type { PillView } from "../../../record/pill/renderer/view";
export type PillUpdate = Partial<{
  view: PillView | null;
  documentReady: boolean;
  destination: DestinationView | null;
  background: BackgroundHandoff | null;
}>;
export interface PillBridge {
  read: () => Promise<PillView | null>;
  retryBackgroundHandoff: (capture: string) => Promise<void>;
  destinations: () => Promise<DestinationView | null>;
  destinationAction: (
    capture: string,
    action: "choose" | "retry" | "cancel" | "dismiss" | "copy" | "setup",
    id?: string,
  ) => Promise<DestinationView | null>;
  destinationFocus: (focused: boolean) => Promise<void>;
  layout: (revision: number) => Promise<void>;
  manualDrag: boolean;
  beginDrag: (revision: number) => Promise<void>;
  beginPaste: (revision: number) => Promise<void>;
  cancelPaste: () => Promise<void>;
  act: (
    revision: number,
    action: string,
    drop?: boolean,
  ) => Promise<void | { cancelled?: true; confirmationRequired?: true }>;
  subscribe: (
    callback: (update: PillUpdate) => void,
    onError: () => void,
  ) => () => void;
}
declare global {
  interface Window {
    apparentPill?: PillBridge;
  }
}
