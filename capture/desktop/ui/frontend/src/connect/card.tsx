import {createPortal} from 'react-dom';
import { Button } from '@apparent/ui/button';
import { StatusCard } from '@apparent/ui/status-card';
import { DisclosureMenu } from '@apparent/ui/disclosure-menu';
import '@apparent/ui/status.css';
import frogs from '../../../../../../shared/assets/brand/connect-frogs.png';
import {useConnectFlow, type ConnectBridge} from './flow';
import {openConnectSession} from './session';
import {connectPresentation, connectActionRole, uploadDisclosure} from './presentation';

const settingsBridge: ConnectBridge = {
  open: current => window.apparent ? openConnectSession(window.apparent, current) : Promise.resolve({status:'disconnected'}),
  read: () => window.apparent?.readConnectSettings() ?? Promise.resolve({status:'disconnected'}),
  command: action => {
    const b=window.apparent;
    if(!b)return Promise.resolve({status:'disconnected'});
    const commands={resume:b.resumeConnectUploads,connect:b.connectSettings,allow:b.allowConnectUploads,cancel:b.cancelConnectSettings,check:b.checkConnectConnection,disable:b.disableConnectUploads,disconnect:b.disconnectConnectSettings,'open-browser':b.openConnectBrowser,'request-disable':b.requestDisableConnectUploads,'request-disconnect':b.requestDisconnectConnectSettings,'open-shared-links':b.openConnectSharedLinks};
    return commands[action]();
  },
};

function closeDisclosure(event: React.KeyboardEvent<HTMLDetailsElement>) {
  if(event.key==='Escape') { event.currentTarget.open=false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation(); }
}

export function ConnectSettingsCard() {
  const {result,busy,request,browserFailed}=useConnectFlow(settingsBridge);

  if (result.status === 'disabled') return null;
  const view = result.status === 'connected' ? result.view : undefined;
  const {presentation:p,step} = connectPresentation(view);
  const buttons = p?.buttons ?? view?.buttons ?? [];
  const menu = new Set(p?.menuActions ?? []);
  const controls = buttons.filter(button => menu.has(button.command));
  const cardButtons = buttons.filter(button => !menu.has(button.command) && button.command !== 'open-browser');
  const browserButton = buttons.find(button=>button.command==='open-browser');
  const actions = browserFailed && browserButton ? [browserButton, ...cardButtons] : cardButtons;
  const waiting = p?.tone === 'progress' && !browserFailed && actions.length === 1 && actions[0].command === 'cancel';
  function renderButton(button: typeof buttons[number], close?: () => void) {
    return <Button key={button.command} variant="ghost"
      className={close ? undefined : connectActionRole(button.command, p?.tone, buttons.map(b=>b.command))}
      disabled={busy || !button.enabled} onClick={() => { close?.(); void request(button.command); }}>{button.title}</Button>;
  }
  const account = p?.accountMenu && <DisclosureMenu label="Account and connection options" trigger={p?.accountInitial ?? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 22v-2a8 8 0 0 1 16 0v2" /></svg>}>
    {close => <>
      <p className="menu-context">This computer{view?.server && <><br />{view.server}</>}</p>
      {controls.map(button => renderButton(button, close))}
      <p className="menu-context">Disconnecting does not delete uploaded captures.</p>
    </>}
  </DisclosureMenu>;
  const accountSlot=document.getElementById('settings-account');
  return <section aria-label="Apparent Connect" className="apparent-connect-workflow" data-waiting={waiting || undefined} data-layout={p?.artwork ? p.compact ? 'connected' : 'invitation' : 'status'}>
    {account && (accountSlot ? createPortal(account,accountSlot) : <div className="flex justify-end pb-4">{account}</div>)}

    <StatusCard tone={p?.tone ?? (view ? 'neutral' : busy ? 'progress' : 'failure')}
      headline={p?.headline ?? view?.status ?? (busy ? 'Reading connection settings…' : 'Connection unavailable.')}
      leading={step !== null && <ol className="connect-progress" aria-label="Connect setup">{['Connect','Approve'].map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined}>{index+1} · {label}</li>)}</ol>}
      footer={actions.length > 0 && <>
        {browserFailed && browserButton && <p className="connect-browser-error" role="alert">The browser could not be opened. Try again, or cancel to keep captures local.</p>}
        <div className="status-actions">
          {actions.map(button => renderButton(button))}
          {buttons.some(b=>b.command==='connect') && p?.tone!=='failure' && <details className="connect-info" onKeyDown={closeDisclosure}><summary>Privacy</summary><p>{uploadDisclosure(view?.encryption)}</p></details>}
          {p?.tone==='failure' && <details className="connect-info" onKeyDown={closeDisclosure}><summary>Details</summary><p>{p.detail}</p></details>}
        </div>
      </>}
      compact={p?.compact} artwork={p?.artwork ? <img src={frogs} alt="" /> : undefined}>
      {p?.tone!=='failure' && (p?.detail ?? view?.detail) && <p>{p?.detail ?? view?.detail}</p>}
      {p?.note && <p className="status-note">{p.note}</p>}

      {!view && <Button className="primary-action" disabled={busy} onClick={() => void request('check')}>Refresh connection</Button>}
    </StatusCard>
  </section>;
}
