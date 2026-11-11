import type { ConnectSettings } from '../bridge';

// Opening Settings may renew an existing session through the native writer.
// Polls stay local; this never starts enrollment or grants upload permission.
export async function openConnectSession(
  bridge: { readConnectSettings(): Promise<ConnectSettings>; checkConnectConnection(): Promise<ConnectSettings> },
  current: () => boolean,
): Promise<ConnectSettings> {
  const snapshot = await bridge.readConnectSettings();
  if (!current() || snapshot.status !== 'connected') return snapshot;
  const buttons = snapshot.view.presentation?.buttons ?? snapshot.view.buttons;
  return buttons.some(button => button.command === 'check' && button.enabled)
    ? bridge.checkConnectConnection() : snapshot;
}
