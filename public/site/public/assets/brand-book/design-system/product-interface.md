# apparent product interface system

Updated: 16.11.2026. Current capture-product direction.

## Purpose and precedence

It’s the machine’s job to understand us, not our job to talk like a machine.
Make expression natural and leave room for play. Optional delight can help
people enjoy making better things; capture and handoff must stay effortless.

Use product truth, safety and accessibility first, then the current
[brand foundations](../brand-guidelines.md), canonical tokens, and the owning
product’s actual shared components. Historical document-processing portals and
Svelte recipes are not current product prescriptions.

## Foundations

Keep the supplied logo masters, Host Grotesk and the five-color identity:

| Role | Value | Use |
| --- | --- | --- |
| Paper | `#F5F0E8` | Reading canvas |
| Stock | `#E7E0EE` | Grouped surface |
| Carbon | `#020102` | Ink and inverse field |
| Lilac | `#B7A5D8` | Selection and meaningful emphasis |
| Signal | `#7A58C7` | Primary action, focus, active workflow |

Use the [JSON tokens](tokens/apparent.tokens.json) and
[CSS tokens](tokens/apparent.css). Host Grotesk weights are 400, 500 and 700;
product type uses 48/24/18 for title/section/body (4:2:1.5), with 16 reserved for short metadata. Use an 8px
spacing base, aligned edges, readable line lengths, and clear grouping. The
[Desktop Settings specification](desktop-settings.md) owns its adopted layout,
compact switches, utility icons, contextual help and theme mapping.

Normal Signal text is allowed on Paper. On Stock or Carbon use it for non-text
UI, focus, graphics, large type, or filled controls with Paper text. Color alone
never communicates state. Semantic success, warning, failure and destructive
colors retain their existing roles. Warning uses Carbon text on gold. Frog
artwork colors are not additional interface tokens.

Interaction roles: Signal identifies choices in the active decision or action flow, including alternatives such as “Activate upload / Not today”. Lilac identifies optional interactions outside that flow. Do not equate active with checked or optional with disabled. Distinguish emphasis within the active choice group through fill, border, placement and wording, rather than assigning an alternative to Lilac just because it is not the default. Carbon remains the readable foreground on Lilac.

Optional command-copy surfaces use Lilac #B7A5D8. Preference-switch tracks use muted neutral gray (#767676) when Off and Signal when On, with a white (#FFFFFF) circular thumb in both themes and states. Keep a 1px Carbon thumb edge for contrast. Gray tracks and white thumbs are functional switch-only exceptions, not new brand accents. Gray means an available Off preference, not a disabled control; keep disabled semantics and treatment separate. Keep tracks free of outlines, thumbs left Off/right On, and keyboard focus visible. Saves succeed quietly; show a native wait cursor over the affected switch while awaiting acknowledgement and announce pending state to assistive technology without visible saving text. Operational failures use the shared ErrorDialog popup, not a new inline page region. Use failure red with an icon and clear message, optional update-style artwork, a specific recovery action first on the left, and Close second. Align the action group left, match DOM and keyboard order, focus recovery on open, support Escape and restore focus on dismissal. Keep field validation beside its field. Commands remain visible with an embedded copy icon, and optional explanations open on hover, focus and click.

Desktop defaults: 216px sidebar, 16px info/copy glyphs with at least 44px targets, 48×24px track and 18px thumb; 48/52 weight-700 title, 24/32 weight-500 section headings, 18/27 weight-500 preference labels and weight-400 body. One Carbon divider below the Settings title; use spacing between ordinary groups. Dark mode keeps Carbon canvas and Paper reading text, with the same neutral Off track and white switch thumb exceptions. Do not use switch gray for body text, utility icons or general surfaces. See the [Desktop Settings specification](desktop-settings.md).

## Actual component library

The [live gallery](https://tryapparent.com/brand/#frontend-design-system) renders
canonical React/shadcn controls from
[shared/ui](https://github.com/tryapparent/apparent/tree/main/shared/ui):

| Component | Purpose | Behavior and states |
| --- | --- | --- |
| Button | Explicit action | Native activation, visible hover/focus, disabled; one primary action |
| Tabs | Related views | Arrow keys, Home/End, selected tab and associated panel |
| NativeSelect | Choose one value | Persistent label and native keyboard behavior |
| StatusCard | Explain an outcome | Written state and icon; neutral, progress, success, warning, failure |
| Native field | Edit a value | Persistent label, linked help, inline validation, retained input |

Each gallery example has usage/source links where a shared component exists.
The field example uses platform HTML; it does not claim an unimplemented shared
input component. Gallery actions do not record, upload, grant permissions or
persist preferences. Use the owning product’s established theme rather than
copying the specimen CSS into every application.

## Workflow boundaries

Desktop offers fast capture and handoff, with conventional controls mainly in
Settings. Connect owns sharing and viewing. Do not add a Desktop review workspace
because a document-processing portal had one.

Distinguish saved locally, copied, uploading, shared and ready to watch. Report
only what the authoritative producer confirms. A copied link does not prove a
recording is ready to watch. A web approval does not prove native registration or
an OS permission. Never invent progress percentages or silently lose work.

Errors name the problem and recovery action. Humor never obscures permission,
privacy, recording state or a failure. Destructive actions require explicit
language and confirmation or an appropriate undo path.

## Expression and accessibility

Reuse [frog artwork](https://tryapparent.com/brand/#frog-collection) and expressive
marks. A frog someone chooses to make jump fits; a joke they must dismiss before
recording does not. Keep longer sequences optional and interruptible. Respect
reduced motion and give every animated state a static cue.

Support keyboard operation, visible focus, 44px primary targets, 200% text resize,
320 CSS px reflow and accessible names. Labels, errors and critical status remain
readable. Test selected, disabled, empty, waiting, error and recovery states where
applicable, in the exact owning renderer.

## Metrics, tables and charts

When data is needed, name the metric, unit, denominator, source, time window,
local zone and uncertainty where relevant. Label illustrative, estimated and
actual values. Use truthful proportions, direct labels and a text/table
alternative. Reuse the owning product’s chart implementation; this guide does not
require a new chart framework. Private captures and personal data do not belong
in public examples, URLs, telemetry or browser persistence.
