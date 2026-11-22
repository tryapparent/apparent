# Installed Linux Storage verification

Use the [isolated Linux runner](../../../capture/desktop/docs/native-testing.md)
and stage the exact AppImage built by the normal Desktop packager. Record the
source commit, AppImage hash, staged Settings entry and Electron version. Install
or place the image under the disposable guest account and use its normal
`launch` entry. Keep the network isolated and use private fixture data and
processes. Inspect the real Settings window in the guest.

The desktop launcher calls `apparent launch`. The native Settings session
selects the presentation and sends pane changes to its existing Electron child.
Settings routes Storage to the shipped React screen and its scoped preload.
The Record workflows supply location and retention intent. The Electron host
supplies its parented chooser and operation lifetime. Native Storage provides
the facts, folder probe, capture-folder usage and the existing config transaction.
The shared Settings runtime already stages the two compiled Record workflows.

## Route and recovery

Start at General and visit Storage, About, Storage, General and Storage, with
both pointer and keyboard. Record the compositor window ID, Electron PID,
position, dimensions and focused window at every transition. Move and resize
the Settings window before repeating the sequence. Check the visible nav
selection and Tab continuation. At 720×530 and the supported 640×530 minimum,
inspect light and dark themes, the usage overview, the maximum GB field and
its focus and validation, and loading, disabled, error and recovery states.

Exercise `experiments.electronCaptureLocation: false` and recover from an
Electron failure while on Storage using the existing native Settings fallback.
Use a new Settings session after restoring the flag. Verify both presentations
read the same fixture config and that recovery does not dispatch a mutation.

## Real provider

- Seed private built-in, saved and override folders with distinct synthetic
  files. Include unrelated top-level and nested retention keys and synthetic
  credentials in the fixture config. Check the recognized preference leaves and
  unrelated values after each mutation.
- Use the actual parented chooser to Cancel and then Change. Compare config
  bytes after Cancel, check the new saved and effective folder after Change,
  and confirm the existing location transaction can reset the saved leaf. Verify that the original files
  stay in place. Repeat with `APPARENT_CAPTURES_DIR` set at app launch and
  verify the override stays effective through both writes.
- Seed known logical usage, confirm the automatically scanned total, then save
  a cap and verify the saved byte threshold through native readback. Save zero
  and verify the usage meter gives way to the unlimited state. Retained legacy
  age settings, unrelated preferences and synthetic captures must survive.
- Exercise a scan failure and recovery with Retry usage scan. Failed scans must
  clear the stale total. Exercise the registered Record worker against synthetic
  capped, recently changed, busy and pinned bundles in the installed runtime.
- Refuse a write through the real provider and recover through Check saved limit. Exercise
  uncertain publication and conflict through the existing fault/transport
  suites when the guest cannot reliably induce them. Record the mutation count
  and verify that another write requires fresh readback.

Capture location takes effect for subsequent captures. Size-based cleanup
rereads the effective location and limit for each pass. The legacy age cleanup
and transcript workers retain their startup directory. Saving a limit nudges
cleanup, which defers during capture. Reuse matching native regression evidence for unchanged worker timing,
durability and live/busy capture protections. Record source and artifact inputs
when reusing evidence. Label simulated socket replies separately from the
installed chooser, native provider and compositor checks.
