import { app, BrowserWindow, session } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerOnboardingProgressBridge } from './onboarding-progress-bridge.cts';
import { registerRecordBridge } from './record/bridge.cts';
import { bindWindowShutdown } from './host-lifecycle.ts';
import type { RecordHostServices } from './record/host.ts';
import { applyPendingAtLaunch, bindUpdater } from './update/service.cts';
let recordBound = false;
let hostShutdown: Promise<void> = Promise.resolve();

// Separate development identity; never touch the installed Apparent profile.
app.setName('Apparent Foundation');
if (process.env.APPARENT_FOUNDATION_PROFILE) {
  app.setPath('userData', process.env.APPARENT_FOUNDATION_PROFILE);
}
app.whenReady().then(async () => {
  if (process.env.APPIMAGE && !app.requestSingleInstanceLock()) { app.quit(); return; }
  if (await applyPendingAtLaunch()) { app.quit(); return; }
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const entry = pathToFileURL(join(__dirname, 'index.html')).href;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(pathToFileURL(__dirname + '/').href);
    callback({ cancel: !allowed });
  });
  let host: { store: import('@apparent/app-contracts/host').ProgressStore<unknown>; close(): Promise<void> } | undefined;
  let recordHost: RecordHostServices | undefined;
  try {
    const ownerBinding = await import(pathToFileURL(join(__dirname, 'owner-binding.mjs')).href) as {
      createRecordHostServices?: (input: { profilePath: string; nativeRoot: string }) => Promise<RecordHostServices>;
      createOnboardingProgressStore?: (input: { configPath: string; configHostPath: string }) => Promise<typeof host>;
    };
    if (typeof ownerBinding.createRecordHostServices === 'function') {
      recordHost = await ownerBinding.createRecordHostServices({ profilePath: app.getPath('userData'), nativeRoot: join(__dirname, 'native-record') });
      recordBound = true;
    } else if (typeof ownerBinding.createOnboardingProgressStore === 'function') {
      try {
        host = await ownerBinding.createOnboardingProgressStore({
          configPath: join(app.getPath('userData'), 'config.json'),
          configHostPath: join(__dirname, 'native', 'apparent-config-host'),
        });
      } catch (error) { console.error('Onboarding progress host unavailable', error); }
    }
  } catch (error) { console.error('Onboarding assembly binding unavailable', error); }
  const window = new BrowserWindow({
    title: 'Apparent Foundation', width: 900, height: 620,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      preload: join(__dirname, 'preload.cjs') },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== entry) event.preventDefault(); });
  const disposeProgress = host ? registerOnboardingProgressBridge({ window, entryUrl: entry, store: host.store }) : undefined;
  const updater = await bindUpdater(window, entry);
  if (recordHost) {
    const ownedHost = recordHost;
    const disposeRecord = registerRecordBridge({ window, entryUrl: entry, client: ownedHost.record });
    const lifecycle = bindWindowShutdown({ window,
      canClose: async () => typeof ownedHost.canClose === 'function' && await ownedHost.canClose() === true,
      close: () => ownedHost.close(), revoke: disposeRecord,
      refused: reason => { updater.refused(); if (!window.isDestroyed()) window.webContents.send('apparent:host:close-refused', reason); },
    });
    window.once('closed', () => { hostShutdown = lifecycle.settled().then(() => updater.closed()); });
  } else {
    const lifecycle = bindWindowShutdown({ window, canClose: async () => true,
      close: async () => { await host?.close(); }, revoke: () => disposeProgress?.(), refused: () => updater.refused() });
    window.once('closed', () => { hostShutdown = lifecycle.settled().then(() => updater.closed()); });
  }
  void window.loadURL(entry);
});
app.on('window-all-closed', () => {
  if (recordBound) void hostShutdown.then(() => app.quit()).catch(error => console.error('Record ownership unresolved; refusing quit', error));
  else void hostShutdown.catch(() => {}).finally(() => app.quit());
});
