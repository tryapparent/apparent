/** Shortcut practice policy. Only the host's native snapshot is an observation;
 * renderer clicks cannot manufacture a successful shortcut choice.
 * Choosing is practice one. The next shortcut starts the real capture.
 */
export function completedSelection(state: {
  step: string; firstCaptureRequired: boolean; shortcut: string;
  shortcutChosen: boolean; shortcutTested: boolean; shortcutEditing: boolean;
  shortcutSelectionReleased: boolean; shortcutEditor: {recording: boolean} | null;
}): string | null {
  return state.step === 'shortcut' && state.firstCaptureRequired && state.shortcutChosen
    && !state.shortcutTested && !state.shortcutEditing && !state.shortcutEditor?.recording
    && state.shortcutSelectionReleased && state.shortcut.length > 0
    ? `accept-shortcut-choice:${state.shortcut}` : null;
}
