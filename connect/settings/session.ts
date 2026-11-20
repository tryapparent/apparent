import type { ConnectSettings } from "../client/typescript/src/account/protocol.ts";

export async function openConnectSession(
  bridge: {
    readConnectSettings(): Promise<ConnectSettings>;
    checkConnectConnection(): Promise<ConnectSettings>;
  },
  current: () => boolean,
): Promise<ConnectSettings> {
  const snapshot = await bridge.readConnectSettings();
  if (!current() || snapshot.status !== "connected") return snapshot;
  const buttons = snapshot.view.presentation?.buttons ?? snapshot.view.buttons;
  return buttons.some((button) => button.command === "check" && button.enabled)
    ? bridge.checkConnectConnection()
    : snapshot;
}

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
  return {
    open: (current) => {
      const bridge = host();
      return bridge ? openConnectSession(bridge, current) : disconnected();
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
