# Hermes engineering

Run from the repository root with Node 22.23+ and Python/Pillow:

```sh
npm ci --ignore-scripts --prefix hermes/enablement
node --experimental-strip-types hermes/enablement/check.ts source
node --experimental-strip-types hermes/enablement/check.ts integration
python3 -m unittest discover -s hermes/tests -v
job=$(mktemp -d /tmp/apparent-dev-hermes-build-XXXXXX)
node --experimental-strip-types hermes/enablement/package.ts "$job/release"
node --experimental-strip-types hermes/enablement/publish.ts "$job/release" --check
```

`package.ts` owns plugin bundling, compatibility/file manifests, installer
compilation, archive and checksum generation. Its only source inputs are Hermes
and `shared/assets/brand/apparent-app-icon.svg`; the locked esbuild dependency is
here. `check.ts clean` exercises the compiled archive in that sparse environment.
The hosted clean job retains its no-Rust/no-other-owner assertions.

`checks.ts` owns the finite local/hosted command inventory. Repository
`enablement/local-tests/run.ts` consumes it after the authoritative central
routing decision; it does not reproduce Hermes commands. Central routing still
composes Hermes with Agent setup, Desktop mailbox and shared brand consumers.
Cross-owner install tests qualify Hermes archives; their Agent setup/receiver
and Desktop protocol implementations remain with those products.
Colocated source unit tests and Python adapter tests stay beside the product.

`.github/workflows/hermes.yml` retains provider permissions, concurrency, exact
candidate artifact identity, Linux/macOS matrix and publication dependencies.
The owner entrypoints perform package/test/release work. `publish.ts` checks the
single archive/checksum pair before creating the immutable prerelease; `--check`
verifies bytes without publishing. Release gating and installed native acceptance
remain distinct from local package success.

## Active cache reservation

PR #1387 owns the in-flight validator/cache changes. This migration deliberately
leaves `hermes/distribution/cache/` and the pinned validator preparation/install/
snapshot workflow blocks untouched. Integrate #1387 first, then move its updated
cache and new `hermes/verification/validator*` tools into this enablement tree with
their imports, workflow commands and cache identity inputs. This is remaining
Hermes migration debt, not an independent-build claim for the native validator.
No competing cache implementation or selector is introduced here.

The old packaging and distribution-test donors have been removed, and all their
callers use these paths. Rollback must revert the path moves together with the
workflow, root runner/fixture-source import and contract assertions. It does not
change installed plugin paths, runtime configuration, plugin activation or OS
permission state.
