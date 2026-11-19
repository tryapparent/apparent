# Onboarding acceptance

Run `npm ci --ignore-scripts --prefix onboarding`, then `npm run check --prefix onboarding`.
On Clanker invoke checks through the existing `t3-build` admission boundary.
This checks the owner policy and private host protocol using Node and TypeScript only.
It does not establish native, renderer, persistence, installed or release acceptance.
The Onboarding workflow runs the same package checks with Node on Linux.

## Authoritative product inventory

| Scope                                                 | Source and state                                                         | Remaining acceptance                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Whiteboard, pen Back, compact coach                   | #1368 and #1430 merged                                                   | Preserve ink until actual board closure and require a fresh screen stroke                                       |
| Custom Option, shortcut suggestions and Back recovery | #1370/#1424 adopted into #1430, a1137ab386f7b764aa5d105ff76769b66883599a | Preserve the default Fn and never suggest standalone Option                                                     |
| Existing delivery                                     | Linux 0.22.8 published; Mac 0.22.8 publisher never acquired a runner     | Parent owns publication and release recovery                                                                    |
| Trusted practice                                      | Frozen #1276 source 153415e51989329afaf6f7f764d6d1adf15e6dfe             | Canonical policy and native bridge integrated locally. Full isolated Linux lesson pending. |
| Visual onboarding review                              | #1341/#1362 shipped in 0.22.6                                            | Preserve accepted appearance and reduced motion                                                                 |
| Final Settings completion                             | Remaining approved #1290 delta                                           | Native practice acceptance must precede activation; retain the real completion/persistence receipt              |
| General/Connect                                       | #1297/#1373 shipped in 0.22.7                                            | Preserve appearance, consent and current writers                                                                |

The canonical practice implementation reconciles the frozen reducer with the landed
whiteboard flow. An ink observation records evidence but does not close the board or
advance teaching until native visibility reports closure. Saved, copied and pasted
facts remain distinct. The native launcher starts the Composition bundle at
`dist/composition/onboarding/entry.cjs`. Native code still verifies capture and
clipboard receipts and commits progress. If the renderer cannot start or the
private pipe fails, the existing native window handles setup. Revert the launcher
and package changes together to restore the previous Electron host.

Required acceptance includes ordered producer-generated facts, retired session and
capture rejection, renderer forgery rejection, native-owned progress persistence,
the full Linux capture/draw/finish/paste/completion sequence, and the actual changed
Electron build in both themes at normal/minimum sizes with keyboard recovery.
The former x64 macOS proof under Rosetta is not ARM-native acceptance.

## Tour traversal

`host/traversal/tour-traversal.bend` owns forward and backward traversal, primary-button
admission, permission detours, and first-capture resume. The Electron host
and the Swift/GPUI fallback send actions to the same native session.
That session supplies effective permission and shortcut facts and remains
responsible for event scoping, permission requests, and progress transactions.

The owner package ships the executable Bend module. The native session has
to start before a renderer is available and continue after its loss. The
same Bend module emits a finite decision table that the existing Cargo entry
generator embeds in the app. Checked-in table data lets an offline native
build consume the policy with the existing Node build dependency. Installed
apps need no JavaScript runtime, network, or sidecar for traversal itself.

Run `node onboarding/enablement/ci/bend/check.ts` for exhaustive table parity
across the production and verification compilers. The owner workflow also
runs Lean verification. After changing the Bend source, regenerate the
native table with `node onboarding/enablement/ci/bend/check.ts --write-native`
and run the check again. For example, changing whether Back from Shortcut
revisits Permissions can be checked with this command and the package smoke
test without Cargo, Electron, or a Mac. Actual OS grants and fallback
presentation still require native acceptance. Roll back the Bend source,
table, Cargo adapter and package wiring together. Saved steps keep the same
names and compatibility aliases.
