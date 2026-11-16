# Agent enablement

Agent owns narrator provisioning and experiment inspection in `scripts/`, media
build/staging and real-provider/package verification in `media/`, and the native
setup fixture in `setup/`. Product workers, media pins and Hermes setup policy
remain in `../media` and `../setup`; they are shipped runtime inputs.

`checks.ts` supplies the Agent command inventory to the shared local/hosted
runner. The existing `capture-tools` gate composes separate Desktop and Agent
inventories, preserving tracked-test discovery and rebuilt-CLI handling.
`dependencies.ts` supplies Agent input consumers to the sole central router;
range qualification and admission remain repository-owned.

From the repository root:

- `node --experimental-strip-types enablement/local-tests/run.ts --agent-media`
  installs, checks, tests and builds the actual media package. Hosted policy CI
  uses the same inventory in its existing Rust-free container.
- `npm --prefix capture/agent/media run test:native` stages the pinned published
  provider and exercises synthetic movie decoding on the current platform.
- `node --experimental-strip-types capture/agent/enablement/media/build.ts`
  builds and stages the Desktop package's Agent inputs. Desktop build/prepare
  and native prerequisites call this entrypoint directly; no donor wrapper remains.
- `node --experimental-strip-types capture/agent/enablement/media/test/package.ts
  --binary <packaged-cli> --settings <packaged-settings>` verifies the installed
  runtime. Linux AppImage and signed Mac candidate workflows invoke this proof.

The native setup fixture retains its disposable hosted Mac gate; it never changes
real Apparent registration. Native provider and installed-package proof still need
the affected OS and actual package; policy checks alone do not establish them.
Narrator source builds remain explicit and require the existing Rust prerequisites.

For rollback, revert moved entrypoints and their callers together. Generated
Desktop paths and immutable media pins are unchanged. Agent still consumes the
root native CLI and Desktop's packaged Electron runtime; this migration claims
no standalone native runtime or whole-Agent build independence.
