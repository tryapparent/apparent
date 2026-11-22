import { ConnectCard, useConnectFlow } from "../../../connect/settings/card";
import { settingsBridge } from "../../../connect/settings/session";

const bridge = settingsBridge(() => window.apparent);

export function useConnectSettings(active: boolean) {
  return useConnectFlow(bridge, active);
}

export { ConnectCard };
