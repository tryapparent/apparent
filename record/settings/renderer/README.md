# Recording context for agents

**Settings → Labs → Recording context for agents** controls the existing
`experiments.agentContext` flag through the shared config transaction. It is off
by default. Settings reads existing values from `~/.config/apparent/config.json`.
Start a new recording for the capture-time collectors to use the updated setting.
Turn the switch off to restore the standard handoff.

Enabling the switch requests desktop accessibility on Linux and readbacks
confirm whether it is available. Some apps need to restart before publishing
their controls. On macOS, it requests the per-app Accessibility grant using
the system prompt. Approve Apparent in Privacy & Security → Accessibility.
Turning Agent Context off stops collecting the extra context. The OS setting
or grant remains available to accessibility tools. A local dev page using
the Apparent SDK can also supply React component and source details.
See the [bundle guide](../../../capture/engine/docs/keyframes-and-text.md).
