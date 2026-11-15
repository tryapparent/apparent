# Accepted live-transcription pill design

**Design accepted by Simon on 15 November 2026. Backend and integration remain open.**

This is the visual and motion reference for a future Desktop live-transcription
control on macOS and Linux. It is a browser-only prototype using Lorem ipsum.
It does not record, transcribe, send audio, alter settings or enable a feature.

## Locked design

- Retain the compact recording capsule: recording cue, timer, waveform,
  Whiteboard, Finish and close, in that order.
- Keep the waveform and Whiteboard adjacent with the ordinary 8px control gap.
  No auto margin or spacer between them. The capsule fits its controls rather
  than reserving the former 540px width.
- A shallow, softly rounded transcript layer extends from behind the capsule,
  slightly inset on both sides. It sits below, never above or beside the controls.
- Show one line of the newest speech. Longer text moves within that fixed line;
  older words fade at the left edge. Keep the newest words and trailing cursor
  fully visible. Do not add a Listening label.
- Hold control positions and capsule width steady as text arrives. Finish
  remains immediately visible; transcript growth never displaces it.
- Dark mode: Carbon controls, dark-lilac transcript layer, Paper reading text
  and cursor, Lilac Finish with Carbon text.
- Light mode: Paper controls, Lilac transcript layer, Carbon reading text and
  cursor, violet Signal Finish with Paper text.
- Use Host Grotesk. The prototype uses a 56px control row, 44px Finish target,
  18px control/transcript text and a 94px overall footprint before preview scaling.

The dark-lilac value `#3B2E50` is a scoped design proposal accepted for this
transcript surface, not a new global brand token. Other colors follow the
[product interface system](../../../../../public/site/public/assets/brand-book/design-system/product-interface.md).
Preserve this composition during implementation. Accessibility and the shared
component system take precedence over incidental prototype pixels; document
necessary differences rather than silently redesigning the control.

## Reproduce the accepted motion

From the repository root, with Node 22.18 or later:

```sh
design_job=$(mktemp -d /tmp/apparent-dev-stt-design-XXXXXX)
node --experimental-strip-types capture/desktop/docs/design/live-transcription/render.ts "$design_job/index.html"
```

Open the printed HTML file. It is self-contained, embeds the existing Host Grotesk
font and needs no server, dependencies, Rust build, credentials or network.
The generated HTML is disposable and stays outside Git. Use a fresh output path;
the renderer refuses to overwrite an existing file.

`prototype.html` contains the composition and styles; `motion.ts` contains the
simulation. `render.ts` strips TypeScript syntax and embeds both runtime and font.
The rendered artifact is the reference, not the unexpanded template.

Both themes receive the same simulated words, roughly one word every 320ms.
Pause/Play and Replay are review controls. Finish freezes its own demo; close
dismisses it. Whiteboard is illustrative. The timer, waveform and looping Lorem
ipsum are synthetic, not accepted capture or transcription policies. Reduced
motion starts paused and disables scroll transitions and cursor blinking.
Narrow previews scale the desktop study; that is not native target-size proof.

## Not decided or authorized by this checkpoint

- Provider/model selection, realtime API and timestamp compatibility.
- Service placement, session protocol, authentication and entitlement contracts.
- Metering, pricing, allowances, retry charges and global spending controls.
- Remote-processing consent, retention commitments and production ZDR activation.
- Reconnect/replay, partial versus final transcript handling, local fallback,
  offline/error recovery and quota exhaustion behavior.
- Production capture/renderer bridges, persistence, packaging, release or activation.

Earlier [STT enhancement #536](https://github.com/tryapparent/apparent/issues/536)
is context, not a settled backend design. This acceptance does not authorize
provider spending or production activation. Keep the backend discussion separate
from the accepted presentation.

## Verification and remaining gates

The accepted temporary prototype was rendered at 728px and 390px widths in both
themes. Browser checks exercised fixed pill bounds, transcript overflow,
Pause, Finish, Replay and page bounds. The regenerated archived source passed
the same checks at both widths. No native renderer, keyboard/screen-reader audit,
real audio, provider call or backend behavior was verified.

Before production acceptance, render the exact Electron build at normal and
smallest supported sizes in both themes. Verify focus, keyboard operation,
reduced motion, actual text contrast and all waiting/failure/recovery states.
Test the relevant real platform bridges and recording lifecycle separately.
An animated mockup is not native STT video proof.
