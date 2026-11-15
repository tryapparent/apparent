# apparent Svelte component system

> Current capture-product direction: [brand foundations](https://tryapparent.com/brand/brand-guidelines.md), [frog collection](https://tryapparent.com/brand/#frog-collection), and [live React component library](https://tryapparent.com/brand/#frontend-design-system). These supersede document-processing positioning and historical Svelte/portal prescriptions below. Reuse the owning product’s shared React controls and existing theme. Optional playfulness is welcome; essential workflows stay effortless.


Status: adopted implementation architecture for Svelte and SvelteKit products.

This document defines how apparent product interfaces use Bits UI and
LayerChart, with selected shadcn-svelte recipes as locally owned source. Bits UI
is the single component-library dependency. shadcn-svelte is not a second
runtime component library or visual system. These tools provide behavior and
implementation structure; they do not own the apparent visual language,
product semantics, or data-visualization rules.

## Authority and ownership

Use sources in this order when they conflict:

1. Accessibility, truthful product semantics, privacy, and user safety.
2. The apparent foundations, product guidance, and tokens in this repository.
3. This Svelte component-system specification.
4. Maintained behavior from Bits UI and LayerChart.
5. Locally owned shadcn-svelte component source.
6. Upstream examples, starter themes, and visual defaults.

The application owns every generated shadcn-svelte file. Upstream source is a
starting point, not a second design system. Do not preserve an upstream style
when it conflicts with an apparent token or component rule.

## Approved stack

| Layer | Approved tool | Responsibility |
| --- | --- | --- |
| Application | Svelte 5 or SvelteKit | Product composition, routing, data, and progressive enhancement |
| Accessible behavior | Bits UI | Headless interaction, keyboard behavior, focus management, and ARIA foundations |
| Component recipes | shadcn-svelte | Optional source distribution for locally owned component anatomy and composition patterns |
| Data visualization | LayerChart 2 through local chart components | Scales, axes, marks, annotations, and chart interaction |
| Brand expression | apparent tokens and local CSS | Color, typography, spacing, geometry, hierarchy, and motion |

Use Bits UI as the only headless component dependency. Adopt a shadcn-svelte
recipe only when it saves meaningful implementation work; once generated, it
is apparent application source built on Bits UI. Do not add shadcn-svelte as a
second runtime abstraction. Use LayerChart directly only inside the local chart
component directory; feature code should consume apparent chart components
instead.

Do not add a second headless primitive library, chart engine, icon system, or
competing theme without a documented interaction or data requirement that the
approved stack cannot meet.

Some shadcn-svelte recipes depend on additional behavior packages. Do not adopt
such a recipe automatically. First determine whether Bits UI or a small local
composition meets the requirement; add another dependency only when the unmet
behavior and maintenance owner are documented.

## Dependency and update policy

- Pin application dependencies and commit the lockfile.
- Record the supported Svelte, Bits UI, and LayerChart major versions in the
  implementing product. Record the shadcn-svelte CLI version when generated
  source is added or refreshed.
- Treat Bits UI and LayerChart as runtime dependencies. Treat shadcn-svelte as
  an optional source-distribution tool, not a runtime component dependency:
  review generated files before committing them.
- Upgrade one layer at a time. Run component, accessibility, browser, and visual
  regression tests after each upgrade.
- Never replace a locally adapted component with a fresh upstream copy without
  reviewing the diff for lost tokens, semantics, states, and tests.
- Preserve package names, versions, source links, and licenses in the
  implementing product's third-party notices.

## Token integration

Import `tokens/apparent.css` once at the application root. Local component CSS
and Tailwind theme aliases must refer to its custom properties; they must not
retype the underlying brand values.

| Component role | apparent source |
| --- | --- |
| Page and reading surface | `--apparent-color-paper` |
| Grouped, muted, and table-header surface | `--apparent-color-stock` |
| Text, rules, axes, and structural borders | `--apparent-color-carbon` |
| Selection, review attention, and comparison | `--apparent-color-lilac` |
| Primary action, visible focus, active route, in-progress state, or one decisive series | `--apparent-color-signal` |
| Text on Carbon or Signal | `--apparent-color-on-dark` |
| Typography | apparent font family, weight, size, and line-height tokens |
| Spacing, corners, borders, control size, and motion | corresponding apparent tokens |

It is acceptable to expose shadcn-compatible semantic aliases such as
`background`, `foreground`, `primary`, `secondary`, `muted`, `border`, and
`ring`, but each approved alias must resolve to an apparent token. Keep the
apparent names as the canonical source.

Set every component radius to the apparent corner token. Remove gradients,
diffuse shadows, translucent glass treatments, and floating-card styling from
generated components. A component named `Card` does not justify card-based page
architecture; prefer contiguous fields and aligned regions.

CSS gradient functions are allowed only to render an approved hatch or dot
pattern as a non-color cue. They must not create decorative color transitions
or encode magnitude.

Do not adopt the default shadcn-svelte chart or status colors. Use the apparent
success, failure, in-progress, warning, destructive, and disabled tokens with a
written label and icon, outline, pattern, or shape. Warning uses Carbon text on
gold. Destructive aliases failure red but retains a separate component variant
and confirmation behavior. Disabled uses Carbon at the approved reduced emphasis
on disabled controls only, not informative text, and not a new hue.

Normal-size Signal text is allowed only on Paper. On Stock or Carbon, reserve
Signal for non-text UI, focus, graphics, large text, or filled controls with
Paper text. Signal and Lilac must also differ through a label, shape, pattern,
position, outline, or other non-color cue.

## Component architecture

Keep local shared components under one application-owned directory, with
primitives, composed product components, and charts separated. A representative
structure is:

```text
src/lib/components/
  ui/       # adapted Bits UI and shadcn-svelte primitives
  product/  # apparent workflows and domain components
  charts/   # apparent chart grammar built on LayerChart
```

Feature routes may compose shared components, but must not restyle their basic
focus, state, spacing, or typography contracts. Prefer variants and explicit
props over route-specific selector overrides.

Each shared component follows the required contract in
`instructions/frontend-implementation.md`. Preserve the semantics and keyboard
behavior supplied by Bits UI unless a tested accessibility requirement demands
a change. Styling a primitive must not remove its accessible name, focus
management, escape behavior, announcements, or disabled semantics.

## shadcn-svelte adoption rules

Before accepting a generated component:

1. Replace upstream visual values with apparent tokens.
2. Remove unapproved radii, shadows, gradients, palette values, and ornamental
   motion.
3. Confirm the component uses Host Grotesk through inheritance.
4. Review its labels, state language, empty state, error recovery, loading
   behavior, and privacy boundary.
5. Verify keyboard operation, focus order, focus return, accessible names, and
   announcements.
6. Add component tests and at least one representative product use.
7. Record any deliberate deviation from the local component contract.

Do not install the entire shadcn-svelte catalogue or keep parallel Bits UI and
shadcn-svelte versions of the same component. Add one local component for each
named product requirement so the maintained surface stays small.

## Chart system

shadcn-svelte's chart source and LayerChart are implementation scaffolding. All
product charts must be exposed through local apparent components such as a
comparison bar chart, time series, range or uncertainty chart, process or
funnel, and qualified metric. These names describe the relationship the chart
communicates, not merely its geometric mark.

Every chart component must require or provide:

1. A concise title that names the metric or relationship.
2. Unit, denominator, time window, and the explicitly named local time zone
   where applicable. UTC is reserved for technical or cross-region contexts.
3. Source, refresh time, assumptions, and a drill-down or evidence path.
4. Evidence status: actual, estimate, forecast, modeled, or illustrative.
5. Explicit uncertainty, thresholds, missing values, and incomplete intervals.
6. Direct series and value labels wherever space allows.
7. A concise text summary and an accessible table or equivalent data view.
8. Responsive behavior that preserves meaning without horizontal reading.

Use aligned position or length and a shared baseline for comparison. Place an
exact value beside the mark it describes when practical. A tooltip may add
detail, but it must not contain the only label, value, qualification, or source.
Legends must pair text with a non-color cue and should be replaced by direct
labels when the chart remains readable.

Carbon establishes axes and baselines. Lilac provides comparison structure.
Signal identifies one selected series, threshold, or decisive transition. Do
not use Signal for every series or repeat it as an unrelated action inside the
same chart region. Forecasts and incomplete intervals use text plus dash,
pattern, outline, or another non-color treatment.

The approved multi-series system is **core plus pattern**. It adds no
categorical hues and supports at most five simultaneously visible series:

1. Signal solid for the selected or decisive series.
2. Lilac solid for the primary comparison.
3. Carbon solid for the baseline comparison.
4. Lilac with stripe, long dash, or another explicit non-color cue.
5. Carbon with dots, short dash, or another explicit non-color cue.

Keep the series order stable and render names and exact values in Carbon. A
repeated hue must never be the only way to identify a series. Stock may provide
quiet plot structure or tracks but is not a standalone series color. If more
than five series are needed, filter, group, use small multiples, change the
relationship, or provide a table. Do not invent `chart-1` through `chart-5`
tokens or adopt library-default categorical colors.

Avoid decorative 3D treatments, decorative or value-encoding gradients,
unlabeled axes, dual axes without a compelling and documented comparison need,
and color-matching legends. Avoid
pie, donut, gauge, radar, and other radial displays when aligned position or
length communicates the relationship more accurately.

Prefer SVG or semantic HTML for ordinary product charts. Canvas is acceptable
for a measured performance need only when an equivalent accessible summary and
data view remain available.

## Validation and acceptance

A Svelte component or chart is ready only after all applicable checks pass:

- Unit and interaction tests for observable behavior.
- Keyboard-only and screen-reader review of critical flows.
- Focus visibility, focus return, and reduced-motion verification.
- Reflow at 320 CSS pixels and zoom at 200 percent.
- Empty, loading, partial, error, disabled, retrying, and long-content states.
- Contrast and non-color state differentiation.
- Chart arithmetic and visual encoding checked separately.
- Visual regression in the implementing product's real browser surface.
- Source, license, and dependency records updated.

Run the implementing product's full build and test suite after generated source
or dependencies change. Library documentation and examples do not substitute
for application-level validation.

## Upstream references

- [Bits UI documentation](https://bits-ui.com/docs)
- [Bits UI styling](https://bits-ui.com/docs/styling)
- [shadcn-svelte documentation](https://www.shadcn-svelte.com/docs)
- [shadcn-svelte chart documentation](https://www.shadcn-svelte.com/docs/components/chart)
- [LayerChart documentation](https://www.layerchart.com/docs)
