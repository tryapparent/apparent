# Frontend implementation instructions

> Current capture-product direction: [brand foundations](https://tryapparent.com/brand/brand-guidelines.md), [frog collection](https://tryapparent.com/brand/#frog-collection), and [live React component library](https://tryapparent.com/brand/#frontend-design-system). These supersede document-processing positioning and historical Svelte/portal prescriptions below. Reuse the owning product’s shared React controls and existing theme. Optional playfulness is welcome; essential workflows stay effortless.


These rules were extracted from the adopted product frontend guidance and
generalized for any apparent interface.

## Component and framework boundary

- Prefer an established, accessible component library over bespoke primitives.
- Apply apparent as a thin theme of tokens, typography, spacing, geometry, and
  selected component overrides.
- Do not introduce a new framework or build pipeline without a named interaction
  requirement.
- Semantic HTML, accessibility, keyboard operation, responsive behavior, and
  clear states take precedence over pixel-perfect fidelity.
- Record a reusable deviation only when it changes a system convention; do not
  fork a component merely to match a mockup.

Use TypeScript and the owning product’s established framework. Desktop and Connect use React with canonical shadcn controls in shared/ui. Public uses React and a TypeScript brand-document shell. Reuse the shared primitives and existing product theme. Historical Svelte recipes and the Flask/Bootstrap portal are reference material, not current requirements.

## Required component contract

Document these fields for every shared component:

1. Purpose and conditions for use.
2. Required anatomy, labels, content, and slots.
3. Mouse, touch, keyboard, and focus behavior.
4. Default, hover, focus, disabled, loading, empty, error, success, partial,
   and retrying states where relevant.
5. Reflow, long-content, zoom, and responsive-table behavior.
6. Accessible name, role, value, contrast, and status announcements.
7. Data allowed in URLs, logs, analytics, and browser storage.
8. Behavior, keyboard, browser, narrow-viewport, and visual tests.

A component is not complete when only its default state matches a mockup.

## Foundation contract

- Use the canonical CSS or JSON tokens. Do not retype shared values in a page.
- Use Host Grotesk at the approved 48/24/18 title/section/body product scale
  (4:2:1.5). Preference labels use 18px at medium weight. The 16px tier is
  reserved for concise metadata; controls, labels, validation, body copy, and
  critical status use 18px or larger.
- Use the 8px spacing base, square corners, 1px Carbon rules, and a clearly
  visible Signal focus treatment.
- Use normal-size Signal text only on Paper. On Stock or Carbon, limit Signal to
  non-text UI, focus, graphics, large text, or filled controls with Paper text.
  Give Signal and Lilac a second distinction such as text, shape, pattern,
  position, or outline.
- Target 44 by 44 CSS pixels for primary controls. This exceeds the 24 by 24
  CSS pixel WCAG 2.2 AA minimum.
- Use brief transitions for controls. Longer playful sequences must be optional, interruptible and respect reduced motion.

## Interaction rules

- Keep essential workflows usable without client-side JavaScript where the
  product architecture allows it.
- Reuse shared primitives for navigation, forms, field errors, pagination,
  status labels, tables, dialogs, alerts, and empty states.
- Do not prefix ordinary product section headings with decorative numbers.
  Number only genuine ordered steps.
- Default time-based results, activity, and history to most recent first and
  expose the active sort. Priority queues may use a clearly labeled urgency
  order instead.
- Prefer relative time when recency is the user's main question. Keep exact
  local date, time, and named zone available for audit and precision. Reserve
  UTC display for technical logs or genuinely cross-region contexts.
- Give inputs persistent labels, visible borders, inline validation, and a 44px
  minimum target. Placeholder text is never the only label.
- Primary actions use Signal, Paper text, an explicit verb, and visible focus.
  In-progress state may use Signal when it belongs to the same active workflow.
- Destructive actions use the approved destructive token, explicit language,
  and confirmation. The token aliases failure red; never reuse Signal as danger.
- Warning uses Carbon text on gold. Disabled controls use reduced-emphasis
  Carbon, native disabled semantics, and an explanation when the reason matters.
  Informative text never uses the 45% disabled-control treatment.
- Long-running actions return a stable identifier and status link. Never show a
  fabricated percentage.
- Use canonical prefixed ULIDs from `design-system/identifiers.md` for durable
  product objects.

## Security and privacy

- Escape untrusted content by default and preserve CSRF protection for writes.
- Avoid unsafe inline HTML and scripts.
- Keep private capture content, transcripts, filenames, source identifiers, and account
  details out of URLs, analytics, client logs, notifications, and browser
  persistence.

## Required validation

- Test observable user flows and accessibility-critical semantics.
- Verify narrow and wide viewports in a real browser.
- Verify keyboard order, focus visibility, field errors, empty states, long
  content, responsive tables, overflow, 200% zoom, and reduced motion.
- Add visual regression coverage when real document-page imagery is introduced.
- Treat implementing-product tests as higher authority than a static specimen
  for behavior, but not for brand foundations.

## Official basis

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [USWDS component guidance](https://designsystem.digital.gov/components/overview/)
- [Bootstrap accessibility guidance](https://getbootstrap.com/docs/5.3/getting-started/accessibility/)
- [Bootstrap CSS variables](https://getbootstrap.com/docs/5.3/customize/css-variables/)
- [Bits UI documentation](https://bits-ui.com/docs)
- [shadcn-svelte documentation](https://www.shadcn-svelte.com/docs)
- [LayerChart documentation](https://www.layerchart.com/docs)
