import { Button } from '@apparent/ui/button';
import { StatusCard } from '@apparent/ui/status-card';
import { DisclosureMenu } from '@apparent/ui/disclosure-menu';
import '@apparent/ui/status.css';
import frogs from '../../../../../shared/assets/brand/connect-frogs.png';
import font from '../../../../../shared/assets/fonts/HostGrotesk-Variable.ttf?url';
import {useConnectFlow, type ConnectBridge} from './onboarding/connect-flow';
import type {ConnectAction, ConnectSettings} from './bridge';

const settingsBridge: ConnectBridge = {
  read: () => window.apparent?.readConnectSettings() ?? Promise.resolve({status:'disconnected'}),
  command: action => {
    const b=window.apparent;
    if(!b)return Promise.resolve({status:'disconnected'});
    const commands={connect:b.connectSettings,allow:b.allowConnectUploads,cancel:b.cancelConnectSettings,check:b.checkConnectConnection,disable:b.disableConnectUploads,disconnect:b.disconnectConnectSettings,'open-browser':b.openConnectBrowser,'request-disable':b.requestDisableConnectUploads,'request-disconnect':b.requestDisconnectConnectSettings,'open-shared-links':b.openConnectSharedLinks};
    return commands[action]();
  },
};

export function ConnectSettingsCard() {
  const {result,busy,request}=useConnectFlow(settingsBridge);

  if (result.status === 'disabled') return null;
  const view = result.status === 'connected' ? result.view : undefined;
  const p = view?.presentation;
  const buttons = p?.buttons ?? view?.buttons ?? [];
  const menu = new Set(p?.menuActions ?? []);
  const controls = buttons.filter(button => menu.has(button.command));
  const cardButtons = buttons.filter(button => !menu.has(button.command));
  function renderButton(button: typeof buttons[number], close?: () => void) {
    const destructive = button.command === 'disconnect' || button.command === 'request-disconnect';
    return <Button key={button.command} variant="ghost"
      className={close ? destructive ? 'disconnect-action' : undefined
        : destructive ? 'destructive-action' : button.command === 'cancel' ? 'secondary-action' : 'primary-action'}
      disabled={busy || !button.enabled} onClick={() => { close?.(); void request(button.command); }}>{button.command==='connect'?'Continue with Google':button.title}</Button>;
  }
  return <section aria-label="Apparent Connect" className="apparent-connect-workflow">
    <style>{`@font-face { font-family: 'Connect Host Grotesk'; src: url('${font}'); }`}</style>
    {p?.accountMenu && <div className="flex justify-end pb-4">
      <DisclosureMenu label="Account and connection options" trigger={p?.accountInitial ?? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></svg>}>
        {close => <>
          <p className="menu-context">This computer{view?.server && <><br />{view.server}</>}</p>
          {controls.map(button => renderButton(button, close))}
          <p className="menu-context">Disconnecting does not delete uploaded captures.</p>
        </>}
      </DisclosureMenu>
    </div>}
    <StatusCard tone={p?.tone ?? (view ? 'neutral' : busy ? 'progress' : 'failure')}
      headline={p?.headline ?? view?.status ?? (busy ? 'Reading connection settings…' : 'Connection unavailable.')}
      compact={p?.compact} artwork={p?.artwork ? <img src={frogs} alt="" /> : undefined}>
      <p>{p?.detail ?? view?.detail ?? 'Open the current Apparent app, then refresh. Local recording remains available.'}</p>
      {buttons.some(b=>b.command==='connect')&&<p className="status-note">Continuing requests upload access for new captures, including recordings, screen images, voice, transcripts and context. Older captures stay local. You approve this computer in your browser.</p>}
      {p?.note && <p className="status-note">{p.note}</p>}
      {cardButtons.length > 0 && <div className="status-actions">{cardButtons.map(button => renderButton(button))}</div>}
      {!view && <Button className="primary-action" disabled={busy} onClick={() => void request('check')}>Refresh connection</Button>}
    </StatusCard>
  </section>;
}
