import type { ComponentProps } from "react";
import { DesktopFrogPreference } from "../../../../onboarding/renderer/frog/preference";
import { bindPreference } from "../../../../shared/settings/binding";

const wardrobeBridge: NonNullable<
  ComponentProps<typeof DesktopFrogPreference>["wardrobe"]
> = {
  read: () => window.apparentLabs.read(),
  enable: bindPreference("labs", "labs.frogWardrobe", (value) =>
    window.apparentLabs.save(value, "frogWardrobe"),
  ),
  act: bindPreference("labs", "labs.frogWardrobe", (intent) =>
    window.apparentLabs.save(undefined, undefined, intent),
  ),
  subscribe: (listener) => window.apparentLabs.subscribe(listener),
};

export function DesktopFrogWithWardrobe(
  props: ComponentProps<typeof DesktopFrogPreference>,
) {
  return <DesktopFrogPreference {...props} wardrobe={wardrobeBridge} />;
}
