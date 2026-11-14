import type {ConnectAction, ConnectSettings} from './protocol.ts';

export type ConnectBridge = {read: () => Promise<ConnectSettings>; open?: (current: () => boolean) => Promise<ConnectSettings>; command: (action: ConnectAction) => Promise<ConnectSettings>; close?: () => void};

// One explicit click covers the displayed local upload disclosure. Keep the
// existing controller's consent admission rather than introducing a writer.
export async function startConnect(bridge: ConnectBridge, current=()=>true): Promise<ConnectSettings> {
  const consent = await bridge.command('connect');
  if(!current())return {status:'cancelled'};
  if (consent.status !== 'connected' || !consent.view.buttons.some(b => b.command === 'allow' && b.enabled)) return consent;
  return bridge.command('allow');
}
