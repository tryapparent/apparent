# apparent design system

This directory is the operational source of truth for designing products,
websites, documents, presentations, data visualizations, and customer-facing
work in the apparent brand.

## Start here

1. Read the live brand book and the machine-readable values in
   `tokens/apparent.tokens.json` or `tokens/apparent.css`. The live book source
   is `public/site/brand/src/brand-document.ts`, with presentation content in
   `public/site/brand/src/brand-slides.ts`.
2. Read `product-interface.md` before designing an application or workflow.
   For Desktop Settings, also read `desktop-settings.md`.
3. Use the owning product’s established stack and canonical controls in
   `shared/ui`; Svelte material is historical reference.
4. Use the token files above; do not retype
   color, spacing, type, geometry, or motion values.
5. Follow `instructions/design-work.md` for design decisions and
   `instructions/frontend-implementation.md` for executable interfaces.
6. Use `product-interface-specimen.svg` and `reference/product-portal/` as
   evidence of application, not as templates that override the canonical rules.

## Source precedence

When guidance conflicts:

1. Accessibility, truthful product semantics, privacy, and user safety.
2. Approved apparent assets and foundations in this repository.
3. `product-interface.md` and the machine-readable tokens.
4. Tested patterns in an implementing product.
5. Specimens, explorations, pitch layouts, and historical references.

Do not copy presentation-scale values into application UI. Do not let a
framework default redefine the brand. Do not let brand fidelity weaken an
accessible, understandable product interaction.

## Contents

- `product-interface.md`: foundations, product translation, components,
  accessibility, credibility, and forbidden treatments.
- `desktop-settings.md`: adopted Desktop Settings composition, help, utility
  icons, switches, palette-preserving dark mode and remaining state decisions.
- `marketing-actions.md`: public-site CTA hierarchy and the secondary-action
  highlighter.
- [Live component library](https://tryapparent.com/brand/#frontend-design-system): actual shared React controls, states, usage and source.
- `svelte-component-system.md`: historical Svelte recipes, not current product prescriptions.
- `identifiers.md`: canonical durable product identifiers.
- `product-interface-specimen.svg`: historical document-product composition.
- `tokens/`: portable JSON and CSS values.
- `instructions/`: working and implementation rules.
- `reference/product-portal/`: preserved Bootstrap 5.3.8 theme and Jinja
  templates from the retired application frontend.

## Known unresolved decisions

- Final responsive type values beyond the adopted product scale.
- Co-branding and partner-lockup specifications.
- Motion patterns beyond timing, easing, and reduced-motion requirements.

Unresolved values must not be invented and presented as approved brand tokens.
