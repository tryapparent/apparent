import type {
  ConnectAction,
  ConnectSettings,
} from "../client/typescript/src/account/protocol.ts";

export type ConnectBridge = {
  read: () => Promise<ConnectSettings>;
  open?: (current: () => boolean) => Promise<ConnectSettings>;
  command: (action: ConnectAction) => Promise<ConnectSettings>;
  close?: () => void;
};

export async function startConnect(
  bridge: ConnectBridge,
  current = () => true,
): Promise<ConnectSettings> {
  const consent = await bridge.command("connect");
  if (!current()) return { status: "cancelled" };
  if (
    consent.status !== "connected" ||
    !consent.view.buttons.some((b) => b.command === "allow" && b.enabled)
  )
    return consent;
  return bridge.command(
    consent.view.reusableUploadGrant === true ? "resume" : "allow",
  );
}
