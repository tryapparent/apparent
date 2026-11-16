# Actions in Apparent content cards

This is the user-selected convention for Apparent custom task cards, not a
universal reversal of native dialogs. OS pickers and alerts keep platform order.

- Put a task's actions left-aligned below its relevant content. Put the recommended
  action first/left with Signal primary treatment, then its alternative with the
  shared 12px action gap (8–12px when using another existing spacing token).
  Never stretch peers with space-between or auto margins.
- Recommendation is a product decision. In a destructive confirmation, recommend
  the safe choice (Keep connected / Keep uploads on). Give the destructive
  alternative a quieter red text/outline role paired with the current surface;
  keep consequences and explicit confirmation. Warning is gold/Carbon; a failed
  outcome stays red and explicitly labelled.
- DOM, reading and Tab order follow the visual order. Wrap naturally with the
  recommendation first/top at narrow widths and enlarged text; do not invert with
  CSS order. Do not add an unscoped Enter handler or infer a destructive default
  from native button-array order. Only the focused control activates.
- Put optional named help (Privacy, Details) immediately after the action. Expand
  its text below the entire group, never between or over the controls. Keep
  decision-critical consequences and actionable error explanations visible above.
- Narrow exception: normal waiting may pair its heading with one trailing secondary
  Cancel, a contextual stop control. Browser-open failure instead puts the error
  above one adjacent Open browser (primary), Cancel (secondary) task group. Retry
  appears only after an actual failure.
- StatusCard centers a fixed 26px icon box and title in one flex row with an 8px
  gap. Icons have block SVGs; never depend on inline baseline alignment. Keep
  headings, supporting text and action groups content-height with small gaps.

[GOV.UK button groups](https://design-system.service.gov.uk/components/button/)
and [Carbon forms](https://www.carbondesignsystem.com/building-blocks/core/patterns/forms)
support leading primary actions in content/form contexts. [Apple alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)
use platform-specific default placement. [Nielsen Norman Group](https://www.nngroup.com/articles/ok-cancel-or-cancel-ok/)
explains that ordering has no universal winner: context and consistency matter.
