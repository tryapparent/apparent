# Desktop Settings

Status: adopted Desktop Settings interaction rules, 15.11.2026.

Use this specification for apparent Desktop Settings on macOS and Linux.
It extends [the product interface system](product-interface.md), not the
generic shell for every web product. Reuse the canonical
[token JSON](tokens/apparent.tokens.json) and [CSS tokens](tokens/apparent.css).

## Composition and typography

- Use Host Grotesk: page title 36/40 at weight 700; section and preference
  labels 18/27 at 500; explanatory text 18/27 at 400. The 16/24 metadata tier
  remains limited to short companion information. Do not introduce weight 600.
- Place one 1px Carbon divider below the page title, aligned to the content
  edges. Use spacing to separate ordinary groups instead of repeating rules.
- Use a 216px Carbon navigation sidebar, Paper navigation text and Lilac
  selection. Preserve the approved wordmark and existing navigation model.
  This is the Desktop default within the generic 216-240px range, not a new
  minimum for every product.
- Use the existing 32px content inset and 8px spacing system. Main content is
  Paper; neutral grouped surfaces are Stock. The optional skill-command copy
  surface uses Lilac, matching the optional preference-switch track.
  Panels and command blocks are
  square, flat and free of gradients or diffuse shadows.
- Verify the complete pane at ordinary and smallest supported window sizes,
  with actual labels, enlarged text and localization. Adapt the layout rather
  than shrinking the type or clipping content.

## Help, commands and utility icons

- Keep optional explanation behind a small info icon beside its section label.
  Open help on hover, keyboard focus and click/tap; keep the trigger named and
  focus visible. Keep preference consequences, current state, errors and
  recovery instructions visible. Do not hide essential decision support in help.
- A visible, inspectable command block uses an embedded copy icon by default.
  A separate full-width or text copy button is unnecessary for this pattern.
  Copying does not run the command or establish installation/connection status.
- Use 16px info and copy glyphs, with at least 44 by 44px interaction targets.
  Optical glyph size and clickable area are separate dimensions.
- Use Carbon for active utility icons. Do not import a consumer-only gray such
  as #625B66 into the brand palette. Make secondary actions quiet through size,
  stroke and placement, not disabled opacity. Lilac identifies optional
  interaction surfaces; Carbon remains their readable icon/text foreground.
  Signal identifies the current decision flow and visible focus, not every
  enabled control or every checked preference.
- Show copy success only after clipboard acknowledgement; provide a usable
  recovery path on failure. The precise feedback treatment remains to be settled.

## Switches

- Use a rounded 48 by 24px track with an 18px circular thumb, inside an
  interaction region at least 48 by 44px. The rounded track and thumb are a
  functional control exception to square panels, not permission for pill cards.
- Optional preference switches use a Lilac track and Carbon thumb without a
  visible outline in both light and dark mode. Keep the geometry stable when
  removing an outline. The thumb is left when off and right when on; expose
  the checked state accessibly. Lilac signals optional interactability in both
  states, not whether the value is enabled. Color never supplies the only
  distinction. The optional command-copy surface uses the same Lilac token.
- Retain a visible setting label and short consequence. A switch represents an
  immediately applied, reversible binary preference, not an arbitrary action.
  Do not introduce a pane-wide Save button for independent immediate settings.
- Provide an accessible name and checked state, keyboard operation and visible
  focus. Distinguish pending persistence, saved state and failure truthfully.
  Never turn a saved preference into proof that an OS effect or installation
  happened.
- Keep successful preference saves quiet. Show saving and errors beside the
  affected setting with a usable recovery action. Do not show routine success
  toasts or add a persistent "Saved" label after every toggle.
- Essential component/state cues need at least 3:1 contrast with adjacent
  colors. Paper against Lilac alone is approximately 1.97:1; it must not be the
  only cue identifying a custom switch or its thumb. Carbon against Paper is
  approximately 18.37:1 with the current main palette.

The reusable dimensions are under `component.desktopSettings` in JSON and
`--apparent-desktop-settings-*` in CSS. Reuse the existing
`geometry.controlMinimum` / `--apparent-control-minimum` for 44px targets.

## Dark-theme principle

Dark mode retains the same five canonical colors. Use Carbon for the main
canvas and Paper for reading text; reuse Stock, Lilac and Signal for their
appropriate surface, selection and focus roles. Do not introduce extra grays
or replace the palette with framework defaults. Token roles may adapt to the
theme, but essential text, control and state cues must retain their required
contrast. The precise dark-theme component treatments still need visual review.

## Remaining decisions and verification

The owner selected the compact geometry, matching Lilac optional-interaction
surfaces, no switch outline in either theme, quiet save success and the
palette-preserving dark-theme principle. Detailed copy-feedback presentation
and other unshown component states remain open; do not present an unreviewed
variant as owner-approved. The implementing
product must still verify actual fonts, focus, keyboard/assistive behavior,
clipboard and persistence, error recovery, both themes and supported sizes.
A design study does not establish native implementation or product acceptance.

## Research basis

These sources inform the constraints, not the exact apparent component sizes:

- [WCAG target minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
  distinguishes the AA 24px target requirement and exceptions from the
  [enhanced 44px target](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).
- [GNOME UI icons](https://developer.gnome.org/hig/guidelines/ui-icons.html) and
  [IBM Carbon icons](https://www.carbondesignsystem.com/building-blocks/foundations/icons/guidelines)
  support small, consistent glyphs with separately padded interaction areas.
- [Apple toggles](https://developer.apple.com/design/human-interface-guidelines/toggles)
  support compact switches in grouped forms and distinguish state beyond hue.
- [GNOME adaptiveness](https://developer.gnome.org/hig/guidelines/adaptive.html)
  calls for sidebar proportions that suit available space and content.
- [WCAG non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
  defines contrast for essential control and state cues.

