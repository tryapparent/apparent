import type { ConnectSettings } from "../client/typescript/src/account/protocol.ts";
import accountPolicy from "../client/typescript/src/account/account-status.mjs";
import type { ConnectBridge } from "./consent.ts";

type ConnectSettingsHost = {
  [K in
    | "readConnectSettings"
    | "checkConnectConnection"
    | "connectSettings"
    | "resumeConnectUploads"
    | "allowConnectUploads"
    | "cancelConnectSettings"
    | "disableConnectUploads"
    | "disconnectConnectSettings"
    | "openConnectBrowser"
    | "requestDisableConnectUploads"
    | "requestDisconnectConnectSettings"
    | "openConnectSharedLinks"]: () => Promise<ConnectSettings>;
};

const disconnected = () => Promise.resolve({ status: "disconnected" } as const);
export function settingsBridge(
  host: () => ConnectSettingsHost | undefined,
): ConnectBridge {
  let opened = false;
  return {
    open: async (current) => {
      const bridge = host();
      if (!bridge) return disconnected();
      const snapshot = await bridge.readConnectSettings();
      if (!current()) return snapshot;
      const view = snapshot.status === "connected" ? snapshot.view : undefined;
      const buttons = view?.presentation?.buttons ?? view?.buttons ?? [];
      const check = accountPolicy.check_on_open(
        opened,
        buttons.some((button) => button.command === "check" && button.enabled),
      );
      opened = true;
      return check ? bridge.checkConnectConnection() : snapshot;
    },
    read: () => host()?.readConnectSettings() ?? disconnected(),
    command: (action) => {
      const bridge = host();
      if (!bridge) return disconnected();
      return {
        connect: bridge.connectSettings,
        resume: bridge.resumeConnectUploads,
        allow: bridge.allowConnectUploads,
        cancel: bridge.cancelConnectSettings,
        check: bridge.checkConnectConnection,
        disable: bridge.disableConnectUploads,
        disconnect: bridge.disconnectConnectSettings,
        "open-browser": bridge.openConnectBrowser,
        "request-disable": bridge.requestDisableConnectUploads,
        "request-disconnect": bridge.requestDisconnectConnectSettings,
        "open-shared-links": bridge.openConnectSharedLinks,
      }[action]();
    },
  };
}
