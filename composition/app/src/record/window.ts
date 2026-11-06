import type { BrowserWindow, BrowserWindowConstructorOptions, Screen } from 'electron';
import { clamp, contains, layout, shape } from './geometry.ts';

/** Existing native pill presentation, selected only by trusted build-time assembly. */
export function recordPillWindowOptions(platform = process.platform): BrowserWindowConstructorOptions {
  if (platform !== 'linux' && platform !== 'darwin') throw new Error('Unsupported pill platform');
  return { ...(platform === 'darwin' ? { type: 'panel', acceptFirstMouse: true } : { focusable: false }),
    width: 640, height: 58, show: false, frame: false, transparent: true, resizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
    title: 'Apparent recording controls' };
}

/** Main measures its pinned document. Renderer messages never supply dimensions or coordinates.
 * This owns presentation only; it does not register native capture exclusions. */
export function bindRecordPillWindow(options: { window: BrowserWindow; screen: Screen; entryUrl: string;
  platform?: NodeJS.Platform; onError?(error: unknown): void }) {
  const { window, screen, entryUrl } = options;
  // Electron's BrowserWindow.webContents getter is no longer usable in closed.
  // Retain the owned emitter before destruction so teardown cannot abort quit.
  const contents = window.webContents;
  const platform = options.platform ?? process.platform;
  let disposed = false, busy = false, failed = false;
  let rowY = 0, rowHeight = 58, mainWidth = 640, rowWidth = 640;
  let appliedShape = '', ignored: boolean | undefined;
  const initialArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const initial = { ...window.getBounds(), x: Math.round(initialArea.x + (initialArea.width - window.getBounds().width) / 2), y: initialArea.y + 34 };
  window.setBounds({ ...initial, ...clamp(initial, initialArea) });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Content protection is not a substitute for the missing versioned Engine exclusion port.
  window.setContentProtection(false);

  const alive = () => !disposed && !failed && !window.isDestroyed() && contents.getURL() === entryUrl;
  const measure = async (): Promise<boolean> => {
    if (busy || !alive()) return false;
    busy = true;
    try {
      const area = screen.getDisplayMatching(window.getBounds()).workArea;
      if (![area.x, area.y, area.width, area.height].every(Number.isFinite) || area.width <= 0 || area.height <= 0) return false;
      const size = await contents.executeJavaScript(`(() => {
        document.documentElement.style.setProperty('--pill-limit', '${Math.min(area.width, 1200)}px');
        const element = document.querySelector('main.pill') ?? document.querySelector('.pill.connection') ?? document.querySelector('#root > [role="alert"]');
        const rect = element?.getBoundingClientRect(), row = document.querySelector('.pill-row')?.getBoundingClientRect();
        return rect && {width: Math.ceil(rect.width), height: Math.ceil(rect.height), mainWidth: Math.ceil(row?.width ?? rect.width), rowHeight: Math.ceil(row?.height ?? rect.height), notes: element.dataset.phase === 'recording' && !!document.querySelector('.pill-notes')};
      })()`);
      if (!alive() || !size || typeof size.notes !== 'boolean' || ![size.width, size.height, size.mainWidth, size.rowHeight].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) return false;
      const before = window.getBounds();
      const width = Math.min(area.width, 1200, Math.max(100, Math.ceil(size.width)));
      const height = Math.min(area.height, 360, Math.max(58, Math.ceil(size.height)));
      const nextRowHeight = Math.min(height, Math.max(56, Math.ceil(size.rowHeight)));
      const nextMainWidth = Math.min(width, Math.max(1, Math.ceil(size.mainWidth)));
      const next = layout(before, area, width, height, nextRowHeight, rowY, nextMainWidth, mainWidth);
      await contents.executeJavaScript(`document.querySelector('main.pill')?.setAttribute('data-pocket-side', '${next.side}')`);
      if (!alive()) return false;
      rowY = next.rowY; rowHeight = nextRowHeight; mainWidth = nextMainWidth; rowWidth = size.notes ? width : mainWidth;
      if (Object.keys(next.bounds).some(key => next.bounds[key as keyof typeof next.bounds] !== before[key as keyof typeof before])) window.setBounds(next.bounds);
      if (platform === 'linux') {
        const key = JSON.stringify([width, height, rowY, rowHeight, rowWidth, mainWidth, screen.getDisplayMatching(window.getBounds()).scaleFactor]);
        if (key !== appliedShape) { window.setShape(shape(width, height, rowY, rowHeight, rowWidth, mainWidth)); appliedShape = key; }
      }
      if (!window.isVisible()) window.showInactive();
      return true;
    } catch (error) { failed = true; options.onError?.(error); return false; }
    finally { busy = false; }
  };
  const loaded = () => { void measure(); };
  const sizing = setInterval(loaded, 250);
  const pointer = platform === 'darwin' ? setInterval(() => {
    if (!alive()) return;
    try {
      const inside = window.isVisible() && contains(screen.getCursorScreenPoint(), window.getBounds(), rowY, rowHeight, rowWidth, mainWidth);
      if (ignored !== !inside) { window.setIgnoreMouseEvents(!inside, { forward: true }); ignored = !inside; }
    } catch (error) { failed = true; options.onError?.(error); }
  }, 16) : undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearInterval(sizing); if (pointer) clearInterval(pointer);
    contents.removeListener('did-finish-load', loaded);
    window.removeListener('closed', dispose);
  };
  contents.on('did-finish-load', loaded);
  window.once('closed', dispose);
  return { measure, dispose };
}
