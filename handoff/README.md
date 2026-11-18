# Handoff

Own clipboard/copy/paste, destination choice, outbound intent, receipts, retry and uncertainty. Composition injects narrow capabilities for Record and Connect; do not import their implementations or fabricate a protocol framework. Connect owns encryption, upload, auth, readiness and revocation.

This is the canonical top-level owner root, not a claim of completed migration. Put owner-specific enablement under enablement/ here. See the root AGENTS.md and shared/enablement/dependency-policy for enforceable boundaries.

## T3 destination picker

The recording controls use the Handoff chooser and controller. The
Composition entry supplies the existing config path and builds into the
Electron pill's existing `t3.cjs` asset. The host still owns the IPC, focus,
window geometry, and native capture lifecycle.

The picker uses T3's `server.getConfig` environment label for multiple
computers. Missing, duplicate, or address-only names receive numeric
disambiguation. Connection addresses remain in Settings. Browse advances
the visible rows without creating outbound intent. Selection and retries
keep the original origin and request identity.
