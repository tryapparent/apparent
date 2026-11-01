# Linux playback lowering (experimental)

This is an optional, manually configured experiment, not general Linux audio
support. The target is **x86-64, PipeWire 1.6.9, WirePlumber 0.5.18, ordinary
mono/stereo playback**, with one active Apparent capture per user session.
Other versions, surround sound, custom filter graphs and unusual routing are
unsupported. macOS keeps its existing CoreAudio implementation.

There is **no live effectiveness indicator**. Settings permits a request; neither
the toggle, a loaded module nor the graph marker proves actual attenuation.
Use the synthetic PCM test below to verify the supported setup.

## What changes

The optional WirePlumber policy attaches a neutral, in-place audio processor to
eligible playback streams. It does not change sink, stream or application volume,
mute, default devices or routing. Installing the policy leaves these neutral
processors present even when the app experiment is off. Streams with an existing
custom filter graph are left alone. Graph order `-35` must be reserved exclusively
for this policy; this is a real numeric order, not an atomic namespaced property.

When capture starts, Apparent starts a small helper off the UI thread. The helper
owns a file-descriptor lock and renews a 600 ms monotonic lease every 200 ms.
The audio processor reads that lease and multiplies samples by `playbackLevel / 100`.
User volume and mute changes still apply normally and are never restored from a
snapshot. Normal stop, cancel, start failure and unwinding drop the capture guard;
stdin EOF ends the helper and clears its lease. If the app/helper crashes or the
helper stops executing, each audio client independently stops applying the
reduction after lease expiry. Expiry takes effect at its next processing block;
it is not an exact wall-clock playback deadline when the system is suspended.

The policy never changes a player's identity or disconnects it. Removing or
stopping the policy is not the recovery mechanism: lease expiry works without it.
A second helper cannot replace the first active capture. Unsupported or failed
setup leaves recording available without a promised reduction. This initial
version does not repair failed graphs or automatically recover across audio-service
restarts: fix setup and restart playback manually.

## Manual setup

Do this only in an idle session where changing your audio policy is acceptable.
**Do not use these commands on a shared test guest, another user's desktop or X1
as a substitute for disposable-VM verification.** No AppImage/package install
runs these steps automatically, and the app does not install or restart services.

1. Check `pipewire --version` and `wireplumber --version`. Use the versions above.
   Build with a C11 compiler and the matching PipeWire/SPA development headers.
   Tests also need Python 3 and an installed Lua 5.3/5.4 library:

   ```sh
   sh capture/desktop/scripts/linux/maintenance/build-playback.sh "$HOME/.cache/apparent-playback-build" --test
   ```

   Alternatively set `SPA_INCLUDE_DIR` to the `spa/include` directory of the
   **PipeWire 1.6.9** source checkout. `audio-plugin.h` is the upstream MIT-licensed
   internal FGA header from that release, copied without modification from
   `spa/plugins/filter-graph/audio-plugin.h`; it is not a promise of ABI stability.
   Build outputs are not installed. `SANITIZE=1` runs the same descriptor/helper
   tests with address and undefined-behavior sanitizers.

2. Inspect the generated artifacts, and install only these two binaries. On the
   targeted Omarchy layout the SPA module goes in the trusted default directory:

   ```sh
   install -Dm755 "$HOME/.cache/apparent-playback-build/apparent-playback-helper" \
     "$HOME/.local/lib/apparent/apparent-playback-helper"
   sudo install -Dm644 "$HOME/.cache/apparent-playback-build/libspa-filter-graph-plugin-apparentlease.so" \
     /usr/lib/spa-0.2/filter-graph/libspa-filter-graph-plugin-apparentlease.so
   ```

   The module and its parent directories must be root-owned and not writable by
   other users. Do not use `SPA_PLUGIN_DIR`/`LADSPA_PATH` overrides as proof that a
   normal client loads it. Other SPA install layouts are not covered by this
   initial manual setup. Refuse to overwrite an unrelated existing module.

3. Confirm no other audio policy uses order `-35`. Copy `capture/desktop/linux/playback/policy.lua`
   to `~/.local/share/wireplumber/scripts/apparent-playback.lua`, without replacing
   an unrelated existing script. Create
   `~/.config/wireplumber/wireplumber.conf.d/90-apparent-playback.conf`:

   ```text
   wireplumber.components = [
     { name = apparent-playback.lua type = script/lua provides = apparent.playback }
   ]
   wireplumber.profiles = { main = { apparent.playback = required } }
   apparent.playback = { exclusive-order-minus35 = true }
   ```

   The lease file must exist before playback clients construct their processors.
   To prepare it on each session start, create the user-service drop-in
   `~/.config/systemd/user/wireplumber.service.d/90-apparent-playback.conf`:

   ```ini
   [Service]
   ExecStartPre=%h/.local/lib/apparent/apparent-playback-helper --init
   ```

   This only validates/initializes the neutral runtime file; it does not start a
   capture or renew a lease. If initialization fails, `ExecStartPre` prevents
   WirePlumber itself from starting, not just this experiment. To roll back that
   startup dependency, remove only this owned drop-in and run
   `systemctl --user daemon-reload` before starting WirePlumber again. Do not
   overwrite an unrelated drop-in. Run
   `systemctl --user daemon-reload`, then inspect
   `systemctl --user show wireplumber -p ExecStartPre` for the installed helper.
   Restart WirePlumber in that idle session (`systemctl --user restart wireplumber`),
   then restart playback applications. This restart can interrupt audio; Apparent
   does not do it for you. Inspect the WirePlumber journal for load errors.

4. Merge these fields into `~/.config/apparent/config.json`, **preserving all other
   keys and secrets**, then restart Apparent:

   ```json
   {
     "experiments": { "linux-playback-ducking": true },
     "lowerPlayback": true,
     "playbackLevel": 20
   }
   ```

   These are existing preferences plus one default-off experiment. General
   Settings exposes the toggle and percentage. `0` requests silence, `100` skips
   the helper, default is `20`. Edits apply to the next capture, not the current
   capture. The experiment is read at capture start and Settings refresh; restart
   is the documented setup procedure. Settings writes the same config file.

## Runtime state and diagnostics

The helper uses `$XDG_RUNTIME_DIR/apparent-duck-v1/leases`: a 0700 private directory,
a 0600, 512-byte stable-inode array of 64 lock-free atomic words. This version
reserves slot zero for its single capture; the remaining slots retain the proven
lease-file layout, not support for concurrent captures. Setup validates ownership,
mode, size, hard links and symlinks and does not block on another initializer.
Missing mapping or invalid state rejects processor construction instead of
pretending to be effective. Never truncate, replace, chmod or delete this file
while any client maps it. It is runtime state, **not another preference store**.

The lock is per user/runtime directory. Do not share or change `XDG_RUNTIME_DIR`
between the app and playback clients. This is a cooperative same-UID protocol,
not isolation from malicious processes running as your user. The processor does
no allocation, locks or file operations in its audio callback.

Inspect the running helper with `pgrep -af apparent-playback-helper`, the app log
for optional-helper failures, and `journalctl --user -u wireplumber`. `pw-dump`
can show the `apparent_playback_v1:Mult` neutral graph marker. **That marker is
configuration evidence only**, not evidence of current-request audio processing.
Do not claim a setup works from those observations alone.

## Test contract

`build-playback.sh OUT --test` exercises the actual exported native factory and
descriptor, persistent/in-place buffers, mono/stereo instances, unsupported replica
indices, normal EOF, single-helper ownership, stopped/killed-helper expiry, zero
and full gain, malformed leases, stable inode, safe lock contention and unsafe mode.
The Lua policy fixture covers delayed node info/channel negotiation, bounded
setup, stale callbacks and both controlled and control-free custom graphs.

The disposable native integration test must additionally record sink-monitor PCM
with a non-reconnecting synthetic player: unchanged player identity, port topology,
volume and mute; actual relative gain during capture; restoration after EOF,
helper SIGSTOP/SIGKILL, app-process failure, and policy removal without renewed
policy code. Cover both mono and stereo, user volume/mute edits, default-off and
100% requests. Exercise the built GPUI Settings controls and real capture start,
stop, cancel and failure, not just the helper. Inspect the generated capture bundle.
These tests must run in an owned disposable guest, with no physical speaker output.
Compare exact port topology around capture actions. A deliberate external
WirePlumber restart can reassign ports; compare the surviving player identity and
channel layout across that restart, not unchanged port-to-channel assignments.
Do not publish private captures or substitute a host build for GUI/native proof.

## Disable, remove or upgrade

Turning the experiment off prevents new helper requests; it does not remove the
manually installed neutral graphs. Finish/cancel capture first. Wait for the helper
to exit (or its lease to expire) before removing anything. Set
`experiments.linux-playback-ducking` to `false` in the same config file. Remove the
WirePlumber config, script and service drop-in you installed, then run
`systemctl --user daemon-reload`. **Log out and back in** so all clients
release their neutral graphs and mappings; this explicit interruption is the
manual removal/upgrade procedure, not an automatic app action. Only then remove
or replace the SPA module/helper. Never delete/truncate a live lease inode.
The runtime directory disappears at session end. Preferences can remain for later
use; no other settings, player state or audio-server configuration is removed.
