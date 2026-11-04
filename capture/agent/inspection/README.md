# Local bundle inspection

`apparent-inspect [BUNDLE|latest] [--json] [--marks] [--experiment agentContext]`
reads existing `.apparent` directories and prints the existing semantic summary,
normalized manifest or mark list. It never fetches remote IDs, authenticates,
uploads, renders images, records, reprocesses or writes a user bundle. Use
`apparent fetch` for remote retrieval. `apparent inspect <remote-id>` keeps its
existing explicit Connect resolver before invoking this same local implementation.

This Rust package owns the existing bundle schema, legacy deserialization,
mark recognition, time-aligned context, summary formatting and local reader.
Engine producers and Desktop consumers import these types and functions through
thin compatibility exports; there is one maintained implementation. Native window
collection, crop computation and media execution stay with their existing owners.
The schema's small WAV-presence reader uses pure Rust `hound`, without capture or
codec execution. This is a bounded extraction, not the TypeScript migration target.

## Build and package

On macOS or Linux, without the root application, Desktop, GPUI, Connect, build.rs,
native capture libraries or their build tools:

    cargo test --locked --offline --manifest-path capture/agent/inspection/Cargo.toml
    cargo package --locked --offline --manifest-path capture/agent/inspection/Cargo.toml
    cargo install --locked --offline --path capture/agent/inspection --root PREFIX

Use a new absolute private PREFIX, following `control-client`'s dedicated-prefix
convention. Run `PREFIX/bin/apparent-inspect` from outside the checkout. Rollback
removes only this prefix's executable; never replace another installed command.
Normal app users need no separate installation: the existing `apparent inspect`
CLI directly adopts this package in the ordinary app build and distribution.
Standalone updates do not replace the statically linked implementation in an
already installed app; those updates still require the ordinary app release.
No runtime downloader, alternate app routing or daemon is introduced.

The standalone reader resolves `latest` and short local names using
`APPARENT_CAPTURES_DIR`, then an absolute `capturesDir` in the existing config,
then the platform's existing built-in captures path. It reads config only and does
not create directories or probe write access. Unlike capture admission, an
unavailable configured directory produces a read error rather than a writable
fallback. Explicit bundle paths do not depend on this lookup. App capture storage
policy remains authoritative and unchanged. Unknown experiment switches retain
the CLI's existing ignored behavior; only agentContext affects inspection output.

Missing/invalid bundles fail with exit 1 and the existing contextual errors;
argument errors use clap exit 2. Legacy optional fields remain optional. Absolute
bundle paths, transcript timing, marks and semantic text remain in output. Paths
stored in manifests are displayed as before; inspection does not execute them.

Tests retain the existing schema/context compatibility cases and exercise the
real executable with isolated synthetic legacy/current/error manifests. No native
capture or media proof is claimed. Before release, require supported-platform
packaged execution and normal exact-commit app publication gates. Independent
review and final integration remain with the parent task.

## Archive and Mac acceptance

The reviewed extraction is a prerequisite for independent app delivery. Static
schema/producer reuse is intentional; the current app's inspection still changes
only when its root executable is rebuilt. Neither this package nor the proof
runner changes installed routing or establishes independent app shipping.

From a clean committed checkout, create the source archive with the package command
above. Retain its SHA-256, source commit and tree identity. On an approved Linux or
Mac host with Node 22.18+, Cargo/rustc and the locked dependencies cached, run:

    node --experimental-strip-types capture/agent/inspection/tests/package-proof.ts \
      /absolute/apparent-inspect-0.1.0.crate EXPECTED_SHA256 /absolute/new-proof-directory

The directory must not exist. The runner checks the archive digest/inventory,
unpacks it outside the checkout, builds, tests and installs it into a
private prefix, then runs that installed executable from a synthetic home. It
checks legacy/current golden output, default platform capture lookup, absolute and
`~/` config lookup, environment precedence, error exits and manifest nonmutation.
It retains command logs and `proof.json`, including source-archive and executable
digests, host/toolchain identity and results. It does not provision a machine,
spend, download at runtime, launch Desktop, touch TCC or publish anything. When a
fresh host lacks cached crates, explicitly fetch the locked dependencies before
running the offline proof; missing dependency/toolchain evidence is not a pass.

Because shared schema consumers moved, Mac acceptance also requires compilation
of the root application from the same complete source tree and real root CLI
comparison. On an approved Mac with its existing documented build prerequisites:

    taskpolicy -c utility cargo build --locked --offline -j 3

Then append `/absolute/source/target/debug/apparent` to the proof command. This
adds real root `inspect` output comparisons; it does not launch the GUI or record
anything. A standalone build cannot establish this root-consumer check. Preserve
the complete source archive's digest/commit separately from the `.crate` digest.
Do not substitute a different installed root binary for candidate compilation.

Mac execution is pending an approved resource/budget for this task. Account
credit, another task's ticket or another issue's allowance does not authorize it.
Parent review and normal application publication gates remain separate.
