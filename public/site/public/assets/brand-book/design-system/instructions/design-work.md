# Designing with apparent

Start with the [brand foundations](../../brand-guidelines.md). The current
landing page supplies the accepted visual character: the existing logo, Paper,
Stock, Carbon, Lilac, Signal, Host Grotesk, expressive marks and peculiar frogs.

## Frame the work

Name the person, their task, and the smallest useful outcome. Our first audience
is creative people who already build personal projects with coding agents for
fun and value good design. Do not require professional design expertise or
specialist vocabulary. Their technology stack is not an audience boundary.

The machine should understand human expression. Play helps people experiment
and make better things, while leaving room for friends and life beyond the
screen. Keep that purpose above the capture mechanism.

## Make the expression playful and the workflow effortless

- Use the existing palette, typography, spacing and supplied logo masters.
- Frogs, drawings, unusual compositions and optional surprises are welcome.
- Reuse originals from the [frog collection](https://tryapparent.com/brand/#frog-collection).
  Its [asset index](../../assets/frogs/collection.json) contains dimensions,
  sources and a reference prompt for new poses.
- Keep chunky pixel artwork distinct from product controls. Artwork colors do
  not introduce new interface colors.
- Reward curiosity without delaying capture, stop or handoff. No mandatory
  jokes, surprise sound, compulsory animation or obstructive play.
- Use brief transitions for controls. Longer playful sequences must be optional,
  interruptible and respect reduced motion.
- Keep text readable, actions obvious and keyboard focus visible. Use a bounded
  reading width and reflow at 320 CSS px and 200% zoom.
- Use Signal for the active action and focus. Status needs a written label plus
  an icon, shape or other cue. Warning uses Carbon text on gold.
- Be literal about saved, copied, uploading, shared and ready to watch. Never
  fabricate progress, permission, delivery or agent behavior.
- Keep errors useful and recoverable. Preserve work and name the next action.

## Build and inspect

Use the owning product’s actual stack and shared controls. The
[live component library](https://tryapparent.com/brand/#frontend-design-system)
uses shared React/shadcn sources, not a separate lookalike library. Follow the
[implementation guidance](frontend-implementation.md) and the adopted
[Desktop Settings specification](../desktop-settings.md) where applicable.

Inspect the exact built renderer at normal and narrow widths. Exercise keyboard,
focus, selected, disabled, waiting, empty, error and recovery states where they
exist. Label illustrations and synthetic examples; do not imply real product
proof from an attractive specimen. Keep private captures out of public assets.
