// Desktop's native presentation barrier. A DOM commit and an older first-paint
// event do not prove that Chromium has composited the committed Settings UI.
export async function committedFrame(contents: {
  capturePage(rect: undefined, options: { stayHidden: true }): Promise<{ isEmpty(): boolean }>;
}): Promise<void> {
  // Request a compositor snapshot without exposing the window or depending on
  // hidden-page animation callbacks. Pixels remain transient and are discarded.
  const frame = await contents.capturePage(undefined, { stayHidden: true });
  if (frame.isEmpty()) throw new Error('Settings has no composited frame');
}
