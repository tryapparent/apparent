import { app, BrowserWindow, session, Tray, nativeImage, dialog } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerOnboardingProgressBridge } from './onboarding-progress-bridge.cts';
import { registerRecordBridge } from './record/bridge.cts';
import { bindWindowShutdown } from './host-lifecycle.ts';
import { recordShutdownEvent } from './record/omarchy/shutdown-diagnostic.ts';
import type { RecordHostServices } from './record/host.ts';
import { bindSilentRecordControls } from './record/omarchy/controls.ts';
declare const APPARENT_OMARCHY: boolean;
declare const APPARENT_TRAY_ICON: string;
let recordBound = false;
let hostShutdown: Promise<void> = Promise.resolve();
// Setup can inspect retained native work. Keep partial handles strongly owned
// after failure; logging an error is never SDK/GUI lifetime clearance.
let retainedSetupFailure: unknown;
let retainedRecordHost: RecordHostServices | undefined;
let ownedWindow: BrowserWindow | undefined;
let entryStarted: 'normal' | 'failure' | undefined;
let bindingStarted = false;
function loadEntry(failure = false) {
  const target = failure ? 'failure' : 'normal';
  if (entryStarted === 'failure' || entryStarted === target || !ownedWindow || ownedWindow.isDestroyed()) return;
  entryStarted = target;
  void ownedWindow.loadURL(pathToFileURL(join(__dirname, 'index.html')).href + (failure ? '#startup-incomplete' : ''))
    .catch(error => console.error('Desktop page unavailable', error));
}
function retainSetupFailure(error: unknown) {
  if (!bindingStarted) {
    // Failure before the fixed binding is entered owns no native resources.
    console.error('Desktop could not initialize before native setup', error);
    retainedSetupFailure = undefined;
    dialog.showErrorBox('Apparent could not start', 'The desktop could not initialize. No native recording services were started.');
    app.exit(1);
    return;
  }
  retainedSetupFailure = { error, recordHost: retainedRecordHost };
  console.error('Desktop startup incomplete; native ownership retained', error);
  if (ownedWindow && !ownedWindow.isDestroyed()) {
    ownedWindow.setTitle('Apparent — startup incomplete; ownership retained');
    ownedWindow.on('close', event => event.preventDefault());
    ownedWindow.show();
    loadEntry(true);
  }
}

// Separate development identity; never touch the installed Apparent profile.
app.setName('Apparent Foundation');
if (process.env.APPARENT_FOUNDATION_PROFILE) {
  app.setPath('userData', process.env.APPARENT_FOUNDATION_PROFILE);
}
// This dedicated profile has exactly one SDK borrower assembly, including if
// its native adapter crashes. A second launch must not create another owner.
const primaryInstance = !APPARENT_OMARCHY || app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);
app.whenReady().then(async () => {
  if (!primaryInstance) return;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const entry = pathToFileURL(join(__dirname, 'index.html')).href;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(pathToFileURL(__dirname + '/').href);
    callback({ cancel: !allowed });
  });
  const createHostWindow = () => {
    const window = new BrowserWindow({
    title: APPARENT_OMARCHY ? 'Apparent' : 'Apparent Foundation', width: 900, height: 620,
    show: !APPARENT_OMARCHY,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
      preload: join(__dirname, 'preload.cjs') },
    });
    ownedWindow = window;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      if (url !== entry && url !== entry + '#startup-incomplete') event.preventDefault();
    });
    return window;
  };
  // Only this package creates its hidden recovery surface before native setup.
  const earlyWindow = APPARENT_OMARCHY ? createHostWindow() : undefined;
  let host: { store: import('@apparent/app-contracts/host').ProgressStore<unknown>; close(): Promise<void> } | undefined;
  let recordHost: RecordHostServices | undefined;
  try {
    const ownerBinding = await import(pathToFileURL(join(__dirname, 'owner-binding.mjs')).href) as {
      createRecordHostServices?: (input: { profilePath: string; nativeRoot: string }) => Promise<RecordHostServices>;
      createOnboardingProgressStore?: (input: { configPath: string; configHostPath: string }) => Promise<typeof host>;
    };
    if (typeof ownerBinding.createRecordHostServices === 'function') {
      bindingStarted = true;
      recordHost = await ownerBinding.createRecordHostServices({ profilePath: app.getPath('userData'), nativeRoot: join(__dirname, 'native-record') });
      retainedRecordHost = recordHost;
      recordBound = true;
    } else if (typeof ownerBinding.createOnboardingProgressStore === 'function') {
      try {
        host = await ownerBinding.createOnboardingProgressStore({
          configPath: join(app.getPath('userData'), 'config.json'),
          configHostPath: join(__dirname, 'native', 'apparent-config-host'),
        });
      } catch (error) { console.error('Onboarding progress host unavailable', error); }
    }
  } catch (error) {
    if (APPARENT_OMARCHY) retainedSetupFailure = error;
    else console.error('Onboarding assembly binding unavailable', error);
  }
  const window = earlyWindow ?? createHostWindow();
  const disposeProgress = host ? registerOnboardingProgressBridge({ window, entryUrl: entry, store: host.store }) : undefined;
  if (recordHost) {
    let ownedHost = recordHost;
    if (APPARENT_OMARCHY) {
      const icon = nativeImage.createFromDataURL(APPARENT_TRAY_ICON).resize({ width: 24, height: 24 });
      if (icon.isEmpty()) throw new Error('Stop control icon unavailable');
      const tray = new Tray(icon);
      tray.setToolTip('Apparent — activate to Stop recording');
      tray.setContextMenu(null);
      ownedHost = bindSilentRecordControls({ host: ownedHost, window, stopControl: {
        onActivate(listener) { tray.on('click', listener); return () => tray.removeListener('click', listener); },
        dispose() { tray.destroy(); },
      }, reportError: error => console.error('Record Stop remains unresolved', error) });
    }
    const disposeRecord = registerRecordBridge({ window, entryUrl: entry, client: ownedHost.record });
    window.on('close', () => recordShutdownEvent('window-close-request'));
    const lifecycle = bindWindowShutdown({ window,
      canClose: async () => {
        const clear = typeof ownedHost.canClose === 'function' && await ownedHost.canClose() === true;
        recordShutdownEvent('window-close-decision', { clear }); return clear;
      },
      close: () => ownedHost.close(), revoke: disposeRecord,
      refused: reason => {
        recordShutdownEvent('window-close-refused', { reason });
        if (!window.isDestroyed()) window.webContents.send('apparent:host:close-refused', reason);
      },
    });
    window.once('closed', () => { hostShutdown = lifecycle.settled(); });
  } else if (APPARENT_OMARCHY) {
    // An ordinary Foundation surface must never substitute for a failed real binding.
    retainSetupFailure(retainedSetupFailure ?? new Error('Omarchy Record host unavailable'));
  } else window.once('closed', () => {
    disposeProgress?.();
    const closing = host;
    hostShutdown = closing ? Promise.resolve().then(() => closing.close()) : Promise.resolve();
    hostShutdown.catch(error => console.error('Onboarding progress shutdown failed', error));
  });
  loadEntry();
}).catch(error => {
  if (APPARENT_OMARCHY) retainSetupFailure(error);
  else console.error('Foundation startup failed', error);
});
app.on('before-quit', event => { if (retainedSetupFailure) event.preventDefault(); });
app.on('window-all-closed', () => {
  if (recordBound) void hostShutdown.then(() => app.quit()).catch(error => console.error('Record ownership unresolved; refusing quit', error));
  else void hostShutdown.catch(() => {}).finally(() => app.quit());
});
