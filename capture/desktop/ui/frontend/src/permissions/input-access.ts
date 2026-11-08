// Presentation policy only. Native adapters supply current device-open facts.
export type InputAccess = { keyboard: boolean; pointer: boolean; loginPending: boolean; restartRequired?: boolean };

export function inputAccessView(access: InputAccess | null) {
  if (!access) return { label: 'Input access unknown', detail: 'Current device access could not be checked. Screen sharing consent does not grant input access.' };
  if (access.restartRequired === undefined) return {
    label: 'Input reader status unknown',
    detail: 'Device permissions were checked, but the current reader could not be verified. Quit and start Apparent before testing global clicks and Shift drawing. Existing readers can retain earlier access until you quit.',
  };
  if (access.loginPending && !(access.keyboard && access.pointer)) return {
    label: 'Log out to apply input access',
    detail: 'The input group is configured, but this session has not received it. Fully log out of the desktop and back in, then start Apparent. Reopening Apparent alone is not enough. Existing readers can retain earlier access until you quit.',
  };
  if (access.restartRequired) return {
    label: 'Restart Apparent to apply input changes',
    detail: 'Device access changed after the input reader started. Finish any capture, then quit and start Apparent before testing clicks and Shift drawing. Existing readers can retain earlier access until you quit.',
  };
  if (access.keyboard && access.pointer) return {
    label: 'Keyboard and mouse access available',
    detail: 'Apparent can read Shift and mouse buttons. Accurate click positions still depend on your desktop; access alone does not verify clicks or ink.',
  };
  return {
    label: access.keyboard || access.pointer ? 'Partial input access' : 'Screen and voice only',
    detail: access.keyboard ? 'Mouse buttons are not readable. Global clicks are unavailable.' : access.pointer ? 'Shift input is not readable. Global Shift drawing is unavailable.' : 'Global clicks and Shift drawing outside Apparent are unavailable. Screen and voice capture remain available.',
  };
}

export const inputConsent = 'Optional input-group setup lets all processes running as your user read keyboard and mouse events, including typing in other apps. It is not an Apparent-only permission. Apparent never runs sudo or changes device access. Screen sharing consent is separate.';
