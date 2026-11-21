import type { DestinationView } from "../../../handoff/pure/destinations.ts";
import type { PillView } from "../../../record/pill/renderer/view";
import type { BackgroundHandoff } from "../../../record/pill/renderer/pill-view";
export type { PillView } from "../../../record/pill/renderer/view";
import type { LipRecordingBridge } from "../../../record/pill/input/renderer";
export interface PillBridge extends LipRecordingBridge {
  read: () => Promise<PillView | null>;
  retryBackgroundHandoff: (capture: string) => Promise<void>;
  backgroundHandoff: () => Promise<BackgroundHandoff | null>;
  subscribeBackgroundHandoff: (
    callback: (state: BackgroundHandoff | null) => void,
  ) => () => void;
  destinations: () => Promise<DestinationView | null>;
  destinationAction: (
    capture: string,
    action: "choose" | "retry" | "cancel" | "dismiss" | "copy" | "setup",
    id?: string,
  ) => Promise<DestinationView | null>;
  destinationFocus: (focused: boolean) => Promise<void>;
  subscribeDestinations: (
    callback: (state: DestinationView | null) => void,
  ) => () => void;
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
  subscribe: (callback: (state: PillView) => void) => () => void;
}
declare global {
  interface Window {
    apparentPill?: PillBridge;
  }
}
