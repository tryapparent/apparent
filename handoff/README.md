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

Opening the picker shows a scrollable catalogue. Search matches thread title,
project, computer and thread state. The last successfully sent recording's
thread appears first and is the quick-send default while it is available.
New thread options follow it, or appear first when the previous thread is unavailable.
The remaining shelves are pinned, inbox, working, snoozed and settled. Within those shelves the picker uses T3's
server timestamps and saved pin keys. T3's client-local folders, project
filters, optimistic moves, and observed inbox return times can differ from
the shell snapshot. Archived threads and subagent threads are excluded.
The collapsed picker retains the existing quick-send shortcut.
An unconfirmed send displays the saved destination and retries the persisted
request. The Handoff renderer receives focus, send and share callbacks from
the existing Electron pill adapter, which remains the native integration point.
