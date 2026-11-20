import { ConnectCard } from "../../../../../../connect/settings/card";
import { settingsBridge } from "../../../../../../connect/settings/session";

const bridge = settingsBridge(() => window.apparent);

export function ConnectSettingsCard() {
  return <ConnectCard bridge={bridge} />;
}
