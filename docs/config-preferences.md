# Config preference coverage

The canonical file is `~/.config/apparent/config.json`; `APPARENT_CONFIG` replaces
its path. It contains requested preferences, not proof that the OS applied them.
Keep unknown keys and secrets when editing it. Application writers must reject
malformed, non-object or unreadable existing files rather than replacing them.

This table records source contracts for the config-preference candidate, based on
the committed shared writer from PR #180 (`191f1df857e356a0bccdf2b27c63631f904ee89e`).
Shortcut and experiment maps mutate inside its locked transaction. This is not
a claim that every row has been exercised on both operating systems.

## User controls

| Preference | JSON path; default and validation | Consumer and file-edit timing |
| --- | --- | --- |
| Launch at login | `launchAtLogin`: boolean; absent leaves OS state alone | Shared Settings writes intent, then reconciles with macOS login registration / Linux autostart. Launch and periodic reconciliation. Inspect actual OS state separately. |
| Record shortcut | `shortcuts.record`: `{keyCode,modifiers,label}`; platform default when absent | Settings applies immediately; direct file edits require restart and obey the same semantic/reserved-key validation. Conflicting record/paste bindings fall back to defaults without rewriting the file. Record cannot be disabled. Hyprland-managed shortcuts can take precedence. |
| Paste shortcut | `shortcuts.paste`: same object, or `null` to disable; platform default when absent | Same as Record. OS reservation/registration is independent of JSON. |
| Microphone | `microphone`: `{id,name}`; absent follows system default | Next recording / input stream. A saved unavailable device stays saved while input falls back. Both OSes; Linux device enumeration requires a suitable audio backend. |
| Lower playback | `lowerPlayback`: boolean, false; `playbackLevel`: integer, 20, capped at 100 after u8 parsing | Next recording guard. Linux mechanics and UI are owned by #35, not this change. |
| Transcription engine | `transcriber`: `apple`, `hex`, `command`; invalid names select platform-local engine | Next engine selection. Local means Apple Speech on Mac and Parakeet on Linux. |
| Warm local recognizer | `warmRecognizer`: boolean, true | Linux Parakeet lifecycle; no Mac counterpart. |
| Hex model and language | `hexModel`: model ID or automatic; `hexLanguage`: supported code, `en` by default | Next Hex selection. Unavailable models and unsupported languages are handled by the engine; language falls back to English. |
| Apple language | `appleLocale`: supported BCP-47 string; absent means automatic | Mac only. Settings restarts the model check; restart after direct file edits to refresh its cached status. |
| Command transcriber | `transcribeCommand`: nonempty string array with absolute executable; `transcribeTimeoutSeconds`: positive bounded number | Loaded when command transcription is selected. Invalid command configuration fails explicitly; no shell evaluation. See keyframes-and-text.md. |
| Export menu | `videoExport`: boolean, false | Current menu construction; CLI export is independent. |
| Capture location | `capturesDir`: absolute path or home-expanded path; absent uses platform capture directory | Read at destination lookup. A temporary exclusive file-creation probe checks effective access, including ACLs/mount policy; failure falls back to the built-in directory. This is a preflight, not a guarantee against later removal or disk exhaustion. Environment override wins. Existing captures are not moved. Linux Settings currently displays location without the Mac folder chooser. |
| Retention | `retention.mediaDays`: u32 or null, 7; `retention.bundleDays`: u32 or null, 30 | Each cleanup pass; Settings requests a pass. Null means forever, zero means immediately eligible. Invalid field falls back independently, preserving a valid sibling. Per-bundle `.pinned` is a separate object-level choice. |
| Last capture mode | `lastCaptureMode`: `area`, `window`, `screen`, `iphone`; default `area` | Loaded at app startup; restart after direct edits. iPhone remains Mac-only. Saved when recording starts. Legacy `last-mode` is read only when the key is absent, and removed only after a successful canonical write. |
| Update channel | `updateChannel`: `stable` or `main`, default stable | Linux subsequent check and pre-install channel guard. Mac Sparkle has no channel control here. |
| Automatic update checks | `automaticUpdateChecks`: boolean; absent uses package defaults (Linux true; Mac package `SUEnableAutomaticChecks`) | Linux reads before each launch/hourly background check. Mac reconciles before starting Sparkle, not from legacy UserDefaults; restart after direct file edits. Manual checks remain available. |
| Automatic update downloads | `automaticUpdateDownloads`: boolean; absent uses package defaults (Linux true; Mac package `SUAutomaticallyUpdate`, false) | Linux false performs discovery only; manual Check still downloads and installs. Rechecked before background download and after download before swap. Mac reconciles at launch; current packages prohibit automatic downloads and installation (`SUAllowsAutomaticUpdates=false`), even when the requested JSON preference is true. |
| Native capsule | `nativePill`: boolean, true on Mac; `pillStyle`: black/glass aliases, black by default | Mac only. Environment/debug tune overrides take precedence. Restart to replace an existing renderer. |
| Screen auto-crop | `autocrop`: boolean or settings object; absent/true uses defaults, false disables | Next processing operation. Invalid fields fall back independently, unknown fields are ignored, and canonical `keepInput` takes precedence over legacy `keepInk`. See keyframes-and-text.md for individual crop fields and command overrides. |
| Hosted uploads | `cloud.enabled`, `cloud.uploadConsent`: booleans; `cloud.server`: validated service URL | Canonical config, additionally gated by `experiments.hostedSync`. Requested consent does not prove a login or upload occurred. Credential/queue files are separate non-preference state; see the hosted writer contract. |
| Experiments | `experiments.<name>`: boolean, supported boolean string or number; false except `agentDemoVideo` | Read at each feature call site. Invalid entries are skipped individually. Settings edits agentDemoVideo; CLI `--experiment` is process-local. Current names and limitations live in keyframes-and-text.md and the feature map. |
| Legacy routing helpers | `routing.apps`, `routing.servers`: string maps; `agentHost`, `agentOpencode`: restricted command/host strings | Retained utilities, not automatic capture delivery. `autoSend` is compatibility data, not an active delivery preference. |

Settings and the microphone CLI use the shared top-level config writer. Experiment
and shortcut maps require a transaction that reads and mutates the nested value
under the same writer lock; a pre-lock snapshot is not safe. No queue or network
lock may be acquired inside that transaction.

## Other stores and non-preferences

- Legacy Application Support shortcut config is migration input, not a second
  active preference authority. Delete it only after canonical persistence succeeds.
- `tune.json` is a documented debug-only motion laboratory. Release builds ignore
  it. Its CLI and reload behavior are documented in motion.md; it is not a hidden
  release-app preference store.
- Hex's own settings and Hyprland bindings are external application/compositor
  preferences. Hex's `transcription.model` also ranks Linux local models. Apparent
  must not rewrite these external preferences to make its JSON appear effective.
- Linux portal restore tokens in `~/.local/share/apparent/portal.json` are opaque
  platform restore/consent state, not a second editable preference authority.
- Sparkle's UserDefaults are a framework compatibility mirror, reconciled from
  JSON/package policy at app launch, not a supported live preference editor.
  Daily check interval (86,400 seconds), system profiling off, packaged feed and
  signature verification are fixed app/package policy. Existing feed overrides
  are cleared through Sparkle's API, not by deleting its defaults domain. Package
  restrictions can make effective downloads false while requested JSON is true;
  startup logs report the actual getters. Current packages expose no automatic
  installation checkbox or permission prompt that would edit a second preference
  store. External `defaults write` while running is outside this launch-time
  contract; restart to reconcile. Last-check dates and skipped versions are
  version-scoped update history, not whole-app preferences.
- Onboarding progress, inbox history, active recording, running PID, installed
  update markers, backup metadata and check results are runtime/history data.
- Permissions, system appearance, installed CLI links and URL-handler registration
  are observed OS state. JSON does not grant access or prove registration.

## Remaining acceptance gaps

Do not claim whole-app coverage until these source findings are resolved or
explicitly scoped out with evidence:

- Shortcut semantics/conflicts, capture-directory effective creation, and
  auto-crop field isolation have portable regressions. Native ACL/read-only-mount
  and Mac stale-defaults behavior still require proof; passing portable tests
  alone does not establish those platform contracts.
- Exact-source Linux GUI and Mac runtime proof, current-main integration and
  independent review are required before calling the candidate merge-ready.
