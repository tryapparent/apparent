# Native producer vector

`rust-v1.json` is a small synthetic output of the actual production Rust `pack`
function, captured by `emit_typescript_producer_fixture`. Its identity is generated
only for this public test vector; it is not a user credential. No private recording
or captured evidence is included.

Ordinary `npm test` decrypts and verifies these bytes without calling the TypeScript
encoder. A normal Rust test also consumes the same checked-in vector through the
production `unpack` path. This catches incompatible reader changes in either
language, independently of a writer/reader roundtrip agreeing with itself.

Regenerate into a new private job output (the generator refuses overwrite):

```sh
APPARENT_CONNECT_FIXTURE_NODE="$(command -v node)" \
APPARENT_CONNECT_FIXTURE_SCRIPT="$PWD/connect/enablement/verification/client/fixtures/capture.ts" \
APPARENT_CONNECT_FIXTURE_OUTPUT="$TMPDIR/rust-v1.json" \
cargo test --manifest-path connect/client/Cargo.toml --offline \
  emit_typescript_producer_fixture -- --ignored --nocapture
```

Set `TMPDIR` to a private `/tmp/apparent-dev-<job>-<run>/` directory and run the
Cargo command through `t3-build` on Clanker. Inspect the synthetic paths/content,
then copy the output here and run both consumer tests. Randomized encryption means
regeneration changes the ciphertext and synthetic identity.

This vector inventories restored main's single-archive age-v1 producer. It does
not certify the separated evidence/media layout from preview/migration branches,
MCP transport, account authorization or native recording. A consumer adopting
another producer/layout must add that producer's vector and acceptance before
claiming compatibility; do not infer it from this vector or a mocked encoder.

`rust-v2.json` was emitted by the native `per_file_native_producer_roundtrip_and_vector`
test via `APPARENT_CONNECT_V2_VECTOR` into private temporary output. Its identities,
media and text are synthetic. It exercises the actual per-file native producer;
TypeScript tests stage only its index plus selected objects to prove interop
without obtaining video ciphertext. Regenerate with that native test rather than
using the TypeScript encoder as its own compatibility oracle.
