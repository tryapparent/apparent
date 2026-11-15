# Marketing actions

This is the canonical action pattern for apparent's public website. It follows
the brand foundation and token roles; it does not replace the product-interface
rules for authenticated workflows.

## Secondary CTA highlighter

Use this treatment only for a named, secondary conversation or conversion
action displayed beside one Signal primary CTA, such as `Book a call` beside
`Get access`.

- Default: Carbon text and a 1px Carbon border on a transparent field.
- Intent: on hover and `:focus-visible`, reveal an irregular Lilac marker behind
  the label. The marker stays close to the label, at 90% opacity, and is never
  the only indication that the element is interactive.
- Geometry: keep the marker inside the action's bounds, behind the text, with a
  restrained handwritten edge. It is a material highlight, not a card, pill, or
  shadow.
- Motion: opacity may change over 120–200ms and the marker may settle into
  place over 120–200ms. Remove the transition for reduced motion.
- Accessibility: retain the visible Carbon border and textual action label;
  keyboard focus receives the same reveal. The public implementation keeps a
  48px-or-larger target.

Do not apply this to primary Signal actions, header utility actions, navigation
links, destructive or disabled controls, status, selected data, or arbitrary
emphasis in body copy. Never use a decorative gradient to imitate the marker;
use the approved `color.lilac` token and the shape itself for material character.
