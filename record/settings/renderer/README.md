# Recording context for agents

**Settings → Labs → Recording context for agents** controls the existing
`experiments.agentContext` flag through the shared config transaction. It is off
by default. Settings reads existing values from `~/.config/apparent/config.json`.
Start a new recording for the capture-time collectors to use the updated setting.
Turn the switch off to restore the standard handoff.

The handoff can include more detail about interactions. On Hyprland, Shift marks
can name controls exposed through AT-SPI. macOS needs Accessibility permission
for native element labels. A local dev page that loads the Apparent SDK can
supply React component and source details when available.
See the [bundle guide](../../../capture/engine/docs/keyframes-and-text.md).
