# apparent brand guidelines

Status: v0.4 capture
Updated: 15.11.2026
Owner: founder approval

## Brand foundations

- Name: `apparent`, lowercase. Unique handle: `tryapparent`.
- Belief: We believe work should be enjoyable and leave us free for late nights with friends.
- Conviction: Through fun, we make better products. Play invites experimentation and care for the details.
- Principle: It’s the machine’s job to understand us, not our job to talk like a machine.
- Purpose: Remove the friction between human expression and computer understanding.
- Audience: Creative people who already have a coding agent set up, make personal projects for fun, and value good design. No professional design expertise, specialist vocabulary or particular technology stack is required.
- Product line: Point. Talk. Draw.
- Today: Screen, voice, pointing and drawing help people show their coding agent what they mean. An agent can use apparent to show what it made in a video walkthrough.
- Vision: A more human collaboration with computers across media and senses. This is a direction, not a claim that all media and senses are supported today.
- Character: Playful, warm, wonderfully weird, expressive and dependable.
- Time: Save room for making your project more delightful and for friends, painting or life beyond the screen. More output is not an obligation.

Keep the logo, five-color palette and Host Grotesk. The landing page’s existing character is the reference. Playfulness must be optional and effortless: no compulsory jokes, surprise sound or obstructive animations. Errors, permissions, capture and handoff stay literal and clear.

For Desktop Settings follow the [adopted specification](./design-system/desktop-settings.md).

## Frog collection

Use the [visual collection](https://tryapparent.com/brand/#frog-collection) and [asset index with reference prompt](./assets/frogs/collection.json). Download and attach the closest original when creating a new pose. Preserve chunky pixels, olive body, cream belly, oversized eyes, dark outline and warm cheek accents. Keep text and logos outside generated artwork. Inspect backgrounds before compositing; new generations are candidates until reviewed. Frog artwork does not introduce new UI colors.

## Component library

The [live component library](https://tryapparent.com/brand/#frontend-design-system) renders shared React/shadcn Button, Tabs, NativeSelect and StatusCard from [shared/ui](https://github.com/tryapparent/apparent/tree/main/shared/ui), plus a native labeled field example and an optional switch composition using shared Button with switch semantics. It includes keyboard behavior, selected, disabled, empty, waiting, success, warning, error and retry states, usage snippets and source links. Examples do not capture, upload or persist settings. Keep the owning product’s theme and stack; the historical portal and Svelte material are not current product prescriptions.

## Logo and highlighting

Use the supplied boxed wordmark whenever the name fits. Use the boxed lowercase
`a` only for favicons, avatars, and compact controls. Never rebuild either mark.

The wordmark color field keeps its highlighter character. Marks make human intention visible: a region, idea or change. Use Lilac for meaningful emphasis and selection, Signal for the primary action and focus. Hand-drawn circles, arrows and imperfect strokes can be expressive. Keep text legible and distinguish illustrative marks from real user input.

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

Interaction roles: Signal identifies choices in the active decision or action flow, including alternatives such as “Activate upload / Not today”. Lilac identifies optional interactions outside that flow. Do not equate active with checked or optional with disabled. Distinguish emphasis within the active choice group through fill, border, placement and wording, rather than assigning an alternative to Lilac just because it is not the default. Carbon remains the readable foreground on Lilac.

Optional command-copy surfaces and preference-switch tracks match in Lilac #B7A5D8. Switches have a Carbon thumb, left Off/right On, with no visible track outline in either theme; keyboard focus remains visible. Preference saves succeed quietly; show saving and errors inline with recovery. Keep preference consequences and errors visible. Put optional explanation behind an info control accessible on hover, focus and click. Commands remain visible with an embedded copy icon, not a full “Copy command” button.

Desktop defaults: 216px sidebar, 16px info/copy glyphs with at least 44px targets, 48×24px track and 18px thumb; 36/40 weight-700 title, 18/27 weight-500 labels, weight-400 body. One Carbon divider below the Settings title; use spacing between ordinary groups. Dark mode keeps the five-color palette with Carbon canvas and Paper reading text. Do not add consumer-only gray #625B66. See the [Desktop Settings specification](./design-system/desktop-settings.md).

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

Use the owning product’s chart implementation behind local components. Historical LayerChart examples do not mandate a new dependency. Carbon establishes axes and baselines, Lilac provides
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

Be warm, playful, peculiar and clear. Invite people to make something. Contractions and an occasional natural exclamation are welcome. Keep instructions and recovery literal; never joke about lost work or permission.


Write directly, compactly, and with technical precision.

1. Lead with what the person wants to make or needs to do.
2. Name the actor and action.
3. Prefer short concrete words.
4. Cut every word that does no work.
5. Keep one claim per sentence.
6. Attach proof, source, timeframe, and evidence status.

Use sentence case and periods. Never use em dashes, unsupported superlatives or decorative type that impairs reading. Label estimates,
forecasts, and illustrative examples.

## Identifiers

Use prefixed ULIDs only. Example:
`run_01JQ7M6J8H9T2R4K5N6P7Q8S9T`.

Approved prefixes are `doc_`, `run_`, `bat_`, `rev_`, and `out_`. Identifiers
are immutable, opaque, stable across retries, free of personal data, and never
used as authorization tokens. See the [identifier standard](./design-system/identifiers.md).

## Frontend engineering

Use TypeScript and the owning product’s established framework. Desktop and Connect use React with canonical shadcn controls in `shared/ui`. Public uses React and a TypeScript brand-document shell. Reuse the actual shared controls; do not introduce a parallel library. Historical Svelte and portal references are not current implementation requirements.

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
