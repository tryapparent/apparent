# apparent product interface design system

Status: adopted product translation; imported into the apparent brand source of truth 21.07.2026

This is the canonical translation of the apparent identity into customer-facing
product interfaces. It does not make the brand-book presentation a runtime
dependency or treat presentation-scale composition as literal application UI.

## Evidence and precedence

This document was imported from `simonvanlaak/scalingtrees-product` commit
`92714494a2dc2fc05c7ca3dc9a2183c854a77ae5`. The product implementation remains
evidence of application behavior, not the owner of the company identity.

Use sources in this order when they conflict:

1. Product semantics and accessibility requirements in the implementing product.
2. Approved apparent brand foundations and assets in this repository.
3. This product-interface design system and its machine-readable tokens.
4. Tested behavior in the preserved product-portal reference implementation.
5. Design explorations and historical presentation material.

The approved identity uses Paper, Stock, Carbon, Lilac, and violet Signal. Earlier
product drafts used Digital white, Graphite, and red Signal; those colors are
superseded. Red is not a brand accent; the approved failure token is a narrow
functional exception. Product status colors remain separate functional tokens,
not brand accents or substitutes for Signal.

## Recovered identity

### Observed rules

- Paper is the default field. Stock and Lilac create selected, grouped, or
  structured regions; Carbon provides ink and occasional inverse fields.
- Signal is controlled violet and marks the decisive word, point, connector,
  selection, or action. It is sparse even when visually dominant.
- Host Grotesk is the only active family. The reviewed source is
  `assets/fonts/studies/HostGrotesk-Variable.ttf` in this repository,
  SHA-256 `74c77b8e850d58dd3d8b22e39111a73bef3450de9fb57018ef99119f2d484f5d`,
  sourced from Google Fonts under SIL OFL 1.1. Applied weights are 400, 500,
  and 700.
- Composition is flat, square-edged, and strongly aligned. Thin Carbon rules,
  large typography, pale-violet planes, and one Signal path establish hierarchy.
- Paper tears, document crops, grids, and registration marks explain a real
  source becoming structured output. They are not ambient decoration.
- Real documents, operational environments, and sourced proof outrank generic
  interface illustration. The applied deck avoids AI glow and code symbolism.

### Product translation

The following rules are proposed rather than observed in shipped product:

- Reduce presentation-scale type to a compact application scale while retaining
  the deck's abrupt 2:1 hierarchy and strong negative headline tracking.
- Use a Carbon navigation rail only as an occasional structural threshold. The
  main workspace stays Paper so evidence and dense data remain readable.
- Treat Lilac as selected or review-attention structure and Stock as the default
  grouped surface. Neither color communicates status by itself.
- Use Signal for one active workflow thread: its primary action, keyboard focus,
  active route, in-progress state, or decisive data highlight. Do not spend it
  on unrelated links or badges.
- Keep document evidence adjacent to decisions. Analytics must drill through to
  the exact documents or runs they summarize.

## Foundations

### Color roles

| Token | Value | Product role |
| --- | --- | --- |
| `color.paper` | `#F5F0E8` | Default canvas, reading surface, neutral control field |
| `color.stock` | `#E7E0EE` | Grouped surface, table header, quiet data region |
| `color.carbon` | `#020102` | Primary ink, rules, inverse navigation or threshold |
| `color.lilac` | `#B7A5D8` | Selected region, review-attention field, secondary series |
| `color.signal` | `#7A58C7` | Primary action, focus, active route, in-progress state, decisive data highlight |
| `color.on-dark` | `#F5F0E8` | Text and icons on Carbon, Signal, or a solid semantic status field |
| `color.status.success` | `#146B43` | Completed, confirmed, delivered, or healthy state |
| `color.status.failure` | `#B42318` | Failed, unavailable, invalid, blocked, or action-required outcome |
| `color.status.inProgress` | `#7A58C7` | Processing, retrying, queued, or incomplete state; aliases Signal |
| `color.status.warning` | `#FFBE2E` | Preventive caution before failure; always use Carbon text on gold |
| `color.status.destructive` | `#B42318` | Destructive action; aliases failure red but requires a separate semantic token and confirmation |
| `color.status.disabled` | `#020102` at 45% emphasis | Neutral unavailable control derived from Carbon, never a new hue |

Signal may identify one active or in-progress thread as well as the primary
action, focus, active route, or decisive data highlight that belongs to that
thread. It is not a success, warning, or failure color. Avoid unrelated Signal
emphasis inside the same component. Write every state and add an icon, outline,
pattern, or shape; color must never carry meaning alone.

Normal-size Signal text is allowed only on Paper. On Stock and Carbon, use
Signal only for non-text UI, visible focus, graphics, large text, or filled
controls with Paper text. Signal and Lilac must never be the sole distinction;
pair either with a label, shape, pattern, position, or outline.

Success, failure, and destructive colors pass AA for normal text on Paper and
Stock. In-progress aliases Signal and is normal-text-safe only on Paper; on
Stock, follow the Signal restrictions above. Carbon on warning gold is 12.56:1;
Paper text on warning gold is prohibited. Disabled controls use Carbon at 45%
emphasis and remain understandable through label, position, and disabled
semantics. The default status presentation uses light fields with strong bars
or icons. Reserve solid semantic fields for actions and escalation.

### Typography

- Family: Host Grotesk; temporary fallback: `system-ui, sans-serif`.
- Weights: 400 body, 500 controls and labels, 700 page claim and key values.
- Product scale: 36/40 heading, 18/27 interface body and controls, and 16/24
  metadata. Use 16px only for short companion text such as timestamps,
  qualifiers and secondary table labels. Never use it for controls, form
  labels, validation messages or critical status. Use weight, spacing and grouping
  instead of intermediate font sizes to establish secondary hierarchy.
- Use sentence case. The brand name is always written `apparent`, including at
  the start of a sentence and in headings, titles, navigation and metadata.
  Use the approved prefixed ULID format, such as
  `doc_01JQ7M6J8H9T2R4K5N6P7Q8S9T`.
- Use negative tracking only at the 36px heading tier. Use tabular numerals for dashboards.
- Keep body lines near 55–75 characters and metadata labels concise.
- Text must resize to 200% without clipping or loss of function, reflow without
  horizontal reading at 320 CSS pixels, and tolerate the WCAG 2.2 text-spacing
  overrides. Define product type in rem units from a 16px user-agent root.

The exact font asset is vendored under `assets/fonts/studies/`; its OFL license
and the applied portal copy are preserved under `design-system/reference/`.
Implementing products must verify rendering at desktop and mobile viewports.

### Geometry and spacing

- Base spacing unit: 8px; allow 4px for compact alignment.
- Sequence: 8, 16, 24, 32, 48, 64, and 96px.
- Desktop shell: 12 columns, 24px gutters, 32px minimum content inset.
- Navigation rail: 216–240px. Dense review workspace: approximately 7/5
  evidence-to-decision columns, adjustable by the reviewer.
- Corners: 0px. Borders: 1px Carbon; selected/focus emphasis: 2px Signal.
- No diffuse shadows. A hard 8–12px offset may show physical document depth.
- Measurement grids belong only inside charts, previews, or processing regions.

## Component behavior

### Shell and navigation

- Keep the route name, tenant/workspace context, and pending-review count visible.
- Mark the active route with a Signal rail plus its text label.
- Initial destinations are Overview, Sources, Documents, Review, Priority
  processing, and Settings; permissions determine visibility.
- Customer navigation never exposes Temporal vocabulary. Restricted operators
  may follow a separate diagnostic link.

### Headings, lists, and time

- Use the section title as the heading. Do not prefix ordinary product sections
  with decorative numbers such as `01` or `02`. Number only genuine ordered
  steps when sequence affects completion or meaning.
- Time-based result, activity, and history lists default to most recent first.
  Show the active sort and allow reversal where useful. A declared priority or
  SLA queue may sort by urgency instead of recency.
- Prefer relative time, such as `12 minutes ago`, when the user mainly needs to
  judge recency. Keep the exact local date, time, and named zone available in
  accessible detail, a tooltip, or the record view.
- Use absolute local time for schedules, deadlines, audit trails, exports,
  older records, and comparisons that require precision. Store UTC internally
  when appropriate, but do not expose it as the default display zone.

### Actions and inputs

- Primary action: Signal field, Paper text, explicit verb, and 2px visible focus.
- Secondary action: Paper or Stock field with a Carbon border and text.
- Destructive actions use `color.status.destructive`, explicit language, and
  confirmation. The token aliases failure red but remains a separate semantic
  role; it never reuses Signal merely because Signal is prominent.
- Disabled controls use Carbon at 45% emphasis with native disabled semantics.
  Informative text stays at normal readable Carbon contrast. Keep the label
  legible and explain why an important action is unavailable.
- Inputs have persistent labels, visible borders, inline validation, and a 44px
  minimum target. Placeholder text is never the only label.
- Long-running actions return a stable document/run identifier and status link;
  the browser request does not remain open as a progress mechanism.
- Canonical identifiers use a lowercase type prefix, an underscore, and an
  uppercase ULID. Follow [`identifiers.md`](identifiers.md). Identifiers never
  grant access and never contain customer data.

### Metrics, tables, and charts

- Prefer contiguous fields and aligned table regions over floating card grids.
- Every metric states its label, value, denominator or time window, and
  drill-down destination.
- Separate business state from operational state. Waiting for review is not a
  failed workflow; retrying source access is not uncertain classification.
- Label chart axes, units, time range, local time zone, and refresh time.
  Default to the user's or operation's local zone and name it explicitly. Use
  UTC only for technical logs or genuinely cross-region coordination, never as
  a user-facing default chosen for implementation convenience. Forecasts and
  incomplete intervals use line style or pattern as well as text.
- Carbon establishes the baseline, Lilac provides comparison structure, and
  Signal selects one series or threshold. Multi-series charts use only these
  core hues. Distinguish repeated Lilac and Carbon series with direct labels,
  stable order, dash, pattern, or outline. Never introduce categorical hues.
- Keep one chart to five visible series or fewer. If five series cannot remain
  clear without color matching, filter, group, use small multiples, change the
  relationship, or provide a table instead of adding colors.
- In Svelte products, implement charts through local apparent components built
  with LayerChart. The shadcn-svelte chart recipe is an optional source starting
  point, not another runtime component system. Do not import chart-engine
  examples directly into feature routes or adopt their default palette.
- A tooltip is supplementary. Keep essential labels, exact values,
  qualification, and source information visible or available in an accessible
  text summary and equivalent data view.
- Follow [`svelte-component-system.md`](svelte-component-system.md) for the
  approved component stack, chart grammar, token mapping, and validation rules.

### Classification review

- Give immutable page or text evidence more space than decision controls.
- Present the reason for review, source evidence, and prior human decisions
  without a proposed family, confidence, automated evidence, provider detail, or
  preselected answer.
- Keep choosing an existing family, creating a family, marking `other`, and
  resolving an operational failure conceptually separate. `uncertain` is a wait
  state and is never a final human label.
- Show the resulting business state after submission. A retried browser request
  must not create a second decision.

### Priority processing

- Show supported file type and size before upload, then validate actual content.
- Require or inherit workflow, priority, and retention policy before submission;
  priority uploads never deliver to Google Drive.
- Return stable identifiers immediately and distinguish a duplicate from a new
  run. High priority never bypasses validation, review, audit, or isolation.

## Motion, accessibility, and credibility

- Use 120–200ms state transitions with standard ease-out and reduced-motion
  alternatives. Never animate a fake percentage; show named durable stages.
- Target WCAG 2.2 AA, keyboard-complete operation, visible focus, screen-reader
  names, 200% zoom, reduced motion, and text alternatives to page imagery.
- Never expose document bodies, filenames, Drive identifiers, or tenant details
  in telemetry labels, notifications, or unauthorized list views.
- Mark illustrative data, estimates, confidence, measured accuracy, and customer
  evidence explicitly. Visual polish must not imply unsupported proof.

## Forbidden treatments

- Red brand accents or the earlier Digital/Graphite palette.
- Generic rounded SaaS cards, pills as the main information architecture,
  glassmorphism, gradients, or diffuse shadows.
- Full-screen grids, decorative paper collage, or torn strips added without an
  input/output or document-boundary role.
- Code, terminal, robot, brain, neural-network, AI-glow, tree, or nature-growth
  motifs.
- Signal used simultaneously for primary action and unlabeled informational or
  error meaning.
- Color-only status, chart legends that require color matching, or metrics
  without a denominator and time window.

## Representative composition

[`product-interface-specimen.svg`](product-interface-specimen.svg) is a static 1440×900
overview using illustrative data and safe product identifiers. It tests the
updated palette, shell, navigation, metric context, operational run comparison,
review queue, processing states, and drill-down hierarchy. It contains no
product behavior and does not approve the unresolved information architecture.

## Validation gaps

- Validate the Signal/Lilac system in each new product surface; it is the current
  durable company identity, not a license to copy presentation layouts literally.
- Continue to test the approved core-plus-pattern chart system and every
  functional state in real components, including color-vision deficiencies.
- Confirm later roles, dashboard metrics, and service targets through product
  discovery; the initial shared-password role and review action set are accepted.
- Test real document preview, dense tables, keyboard order, 200% zoom,
  color-vision deficiencies, and screen-reader alternatives in an executable UI.
- Extend visual-regression coverage when real document-page imagery is added.

## Implemented frontend boundary

The first reference portal uses vendored Bootstrap 5.3.8 under the MIT license. This is the
maintained component and responsive-layout layer; `reference/product-portal/static/app.css` applies
the five-color identity, Host Grotesk, square geometry, and focus treatment as a
thin theme. The compiled upstream assets are pinned locally to support self-hosted
and disconnected deployments without a CDN or Node build service. Upgrade by
replacing the compiled distribution and license together, then rerun browser,
accessibility, and full-product verification.
