import { T3DestinationPicker } from "../../../handoff/renderer/picker.tsx";
import type { DestinationView } from "../../../handoff/pure/destinations.ts";
import type { PillView } from "./bridge";

export function DestinationPicker({
  view,
  disabled,
  shareAction,
  onShare,
}: {
  view: DestinationView;
  disabled?: boolean;
  shareAction?: PillView["actions"][number];
  onShare?: () => void;
}) {
  return (
    <T3DestinationPicker
      view={view}
      disabled={disabled}
      shareAction={shareAction}
      onShare={onShare}
      onAction={(action, id) =>
        window.apparentPill!.destinationAction(view.capture, action, id)
      }
      onFocus={(focused) => window.apparentPill!.destinationFocus(focused)}
    />
  );
}
