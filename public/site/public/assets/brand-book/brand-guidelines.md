# apparent brand guidelines

Status: v0.3 review
Updated: 22.07.2026
Owner: founder approval

## Brand foundations

- Name: `apparent`. Always lowercase, including sentence starts, headings,
  titles, metadata, and navigation.
- Category: AI-ready operational data.
- Company: the operational-data platform for AI-native companies.
- Enduring promise: Operational data you can build on.
- Product proposition: Documents ready for AI.
- Character: lean, fast, technical, assured, and precise.

The display name is always `apparent`. When a service requires a globally
unique handle or the plain name is unavailable, use `tryapparent`. Use it
consistently for LinkedIn, GitHub, social accounts, package scopes, and similar
namespaces. Do not create variants such as getapparent, apparent-ai, or
apparent-hq.

## Logo and highlighting

Use the supplied boxed wordmark whenever the name fits. Use the boxed lowercase
`a` only for favicons, avatars, and compact controls. Never rebuild either mark.

The wordmark color field is a highlighter metaphor. It represents apparent
finding the part that matters, revealing structure, and making document
knowledge usable. Use Lilac highlights for source evidence, extracted fields,
selected regions, and structured information. Use Signal for one decisive
action or transition. Highlights stay rectangular, close to the content they
explain, and sparse. They never float as decoration.

- Wordmark clear space: 0.5 times the complete color-box height on every side.
- Wordmark digital minimum: 120px wide.
- Icon clear space: 0.5 times the icon width on every side.
- Icon digital minimum: 24 by 24px.

### Secondary call-to-action highlighter

On the public site, a named secondary conversation action may use the Lilac
highlighter treatment when paired with one Signal primary CTA. Keep Carbon text
and a 1px Carbon border at rest. Reveal the irregular Lilac marker behind the
label only on hover and keyboard focus, with reduced-motion support. The label
and border remain the affordance; the marker is not a status or selection cue.

Do not use this treatment on primary Signal actions, header utility actions,
navigation links, disabled or destructive controls, data selection, or ordinary
text emphasis. Use the canonical `color.lilac` token, never a decorative
gradient. The complete implementation rule is in the
[marketing-actions design-system standard](../design-system/marketing-actions.md).

## Color

| Role | Value | Use |
| --- | --- | --- |
| Paper | `#F5F0E8` | Primary reading surface |
| Stock | `#E7E0EE` | Grouped structure |
| Carbon | `#020102` | Text and inverse field |
| Lilac | `#B7A5D8` | Selection and depth |
| Signal | `#7A58C7` | Active or decisive workflow thread |

Signal may identify in-progress work, the related primary action, focus, active
route, or one decisive data highlight. It is not a success, warning, or error
color. Avoid unrelated Signal emphasis in the same component. Color never
carries meaning alone.

Normal-size Signal text is allowed only on Paper. On Stock or Carbon, use
Signal for non-text UI, focus, graphics, large text, or filled controls with
Paper text. Signal and Lilac always need a second distinction such as a label,
shape, pattern, position, or outline.

### Functional status colors

| State | Token | Value | Use |
| --- | --- | --- | --- |
| Success | `color.status.success` | `#146B43` | Completed, confirmed, delivered, or healthy |
| In progress | `color.status.inProgress` | `#7A58C7` | Processing, retrying, queued, or incomplete |
| Warning | `color.status.warning` | `#FFBE2E` | Preventive caution before failure; use Carbon text |
| Failure | `color.status.failure` | `#B42318` | Failed, unavailable, invalid, blocked, or action required |
| Destructive | `color.status.destructive` | `#B42318` | Destructive action with explicit confirmation |
| Disabled | `color.status.disabled` | Carbon at 45% emphasis | Unavailable neutral control only; informative text remains readable Carbon |

Always pair a status color with a written label and icon, outline, pattern, or
shape. Default to light fields with strong bars or icons. Reserve solid semantic
fields for actions and escalation. Carbon on warning gold is 12.56:1; Paper text
on warning gold is prohibited. Failure and destructive share a hue but retain
separate semantic tokens and behaviors.

## Typeface and layout

Use Host Grotesk only, at weights 400, 500, and 700.

- Presentation: 120 / 60 / 30.
- Product: 36 / 18 / 16. Reserve 16px for short companion metadata.
- Body: 18 / 27 with lines near 55 to 75 characters.
- Product spacing uses an 8px base.
- Desktop uses 12 columns, 24px gutters, and a 32px content inset.
- Geometry is square with 1px Carbon rules.

Target WCAG 2.2 AA. Support keyboard use, visible focus, 200% text resize,
320 CSS px reflow, reduced motion, and text alternatives.

## Data visualization

Charts make the relationship and evidence status auditable. Every chart names
its metric, unit, denominator, time window, local time zone, source, refresh time,
assumptions, status, and uncertainty where applicable. Label actual, estimate,
forecast, modeled, and illustrative data explicitly.

Use aligned bars or dots for comparison, time series for trends, ranges or
thresholds for uncertainty, and named stages for a process or funnel. Use direct
labels, exact values, truthful proportions, and shared baselines. A tooltip is
supplementary. Provide a concise text summary and an accessible table or
equivalent data view.

Display time in the user's or operation's local zone and name the zone
explicitly, for example `09:42 CEST`. Use UTC only for technical logs or
genuinely cross-region coordination. Do not expose UTC merely because the
backend stores it.

LayerChart 2 is the single chart engine and remains behind locally owned
apparent chart components. shadcn-svelte chart source is optional scaffolding,
not a visual authority. Carbon establishes axes and baselines, Lilac provides
comparison structure, and Signal selects one series or threshold.

The approved multi-series system is core plus pattern and introduces no new
categorical hues. Use Signal solid for one selected series, Lilac and Carbon for
comparisons, then repeat Lilac and Carbon only with direct labels plus distinct
dash, pattern, or outline. Keep no more than five simultaneously visible series.
If the relationship remains unclear, filter, group, use small multiples, change
the chart, or provide a table instead of adding colors.

Do not use decorative 3D treatments, decorative or value-encoding gradients,
unlabeled axes, color-matching legends, or library-default palettes. CSS
gradient functions may render approved hatch or dot patterns only. Pair color
with text, dash, pattern, outline, or another non-color cue.

## Voice and writing

Write directly, compactly, and with technical precision.

1. Lead with the operational fact.
2. Name the actor and action.
3. Prefer short concrete words.
4. Cut every word that does no work.
5. Keep one claim per sentence.
6. Attach proof, source, timeframe, and evidence status.

Use sentence case and periods. Never use em dashes, hype, exclamation marks,
emoji, decorative Unicode type, or unsupported superlatives. Label estimates,
forecasts, and illustrative examples.

## Identifiers

Use prefixed ULIDs only. Example:
`run_01JQ7M6J8H9T2R4K5N6P7Q8S9T`.

Approved prefixes are `doc_`, `run_`, `bat_`, `rev_`, and `out_`. Identifiers
are immutable, opaque, stable across retries, free of personal data, and never
used as authorization tokens. See the [identifier standard](./design-system/identifiers.md).

## Frontend engineering

For Svelte 5 and SvelteKit products, Bits UI is the single component-library
dependency. shadcn-svelte is an optional source recipe catalogue, not a second
runtime component system. Generated recipes become locally owned apparent
components. LayerChart 2 is the single chart engine and remains behind local
apparent chart components.

Use semantic HTML, shared components, progressive enhancement where the product
architecture allows it, and apparent tokens as the visual authority. Do not
adopt library-default color, type, radius, shadow, card, motion, or chart-palette
values.

Each component documents purpose, anatomy, behavior, complete states,
responsive behavior, accessibility, privacy, and tests. Required states include
default, hover, focus, disabled, loading, empty, error, success, partial, and
retrying where relevant.

Use an ordinary section title without decorative `01` or `02` prefixes. Number
only genuine ordered steps. Time-based result and activity lists default to
most recent first, expose the active sort, and may be reversed. Priority or SLA
queues may use a clearly labeled urgency order instead.

Prefer relative time when recency is the user's main question. Keep the exact
local date, time, and named zone available in accessible detail. Use absolute
local time for schedules, deadlines, audit trails, exports, older records, and
precise comparison.

Primary controls target 44 by 44 CSS pixels. Long-running work returns a stable
prefixed ULID and status link immediately. Keep document bodies, filenames,
tenant data, and source IDs out of URLs, telemetry, notifications, and browser
persistence.

See the [frontend instructions](./design-system/instructions/frontend-implementation.md),
[Svelte component system](./design-system/svelte-component-system.md), and
[product interface system](./design-system/product-interface.md).

## Agent use

Start with [`llms.txt`](./llms.txt). Prefer Markdown, JSON, CSS, and supplied SVG
masters over visual inference. Do not fill unresolved decisions. Do not infer
proof from polish. Use the exact machine-readable [JSON tokens](./design-system/tokens/apparent.tokens.json).

## Governance

This repository is the source of truth. Exceptions require a reason, owner,
approval, and expiry. Open decisions include print colors, co-branding, and
final responsive type values.
