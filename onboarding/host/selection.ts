export function completedSelection(state: {
  step: string;
  firstCaptureRequired: boolean;
  shortcut: string;
  shortcutChosen: boolean;
  shortcutTested: boolean;
  shortcutEditing: boolean;
  shortcutSelectionReleased: boolean;
  shortcutEditor: {
    recording: boolean;
  } | null;
}): string | null {
  return state.step === "shortcut" &&
    state.firstCaptureRequired &&
    state.shortcutChosen &&
    !state.shortcutTested &&
    !state.shortcutEditing &&
    !state.shortcutEditor?.recording &&
    state.shortcutSelectionReleased &&
    state.shortcut.length > 0
    ? `accept-shortcut-choice:${state.shortcut}`
    : null;
}
