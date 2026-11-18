# Bend2 owner builds

Record completion builds typed Bend2 policy into a standalone ES module.
Use Bend2 for suitable pure decisions and state transformations that
benefit from types and laws. Keep integrations, UI, effects and build tooling in
TypeScript, and keep OS and capture execution in native code.

1. Add the source within its canonical owner. In
   `<owner>/enablement/ci/bend/modules.json`, list its owner-relative path in
   `modules`. List relevant owner-relative paths in `inputs` for affected
   verification. A trailing slash selects a directory. Root Enablement uses
   `enablement/ci/bend/`. Module basenames must be unique within the manifest.
2. Call the shared `buildBend` entrypoint from the owner's `build.ts` and
   wire it to the normal build. It emits a `<basename>.mjs` for every declaration
   into the owner's build output. Give the JavaScript consumer a TypeScript
   declaration where needed. Include the module in the actual bundler or
   package inputs and verify the runtime import after packaging.
3. In the owner's `check.ts`, call the same build function with
   `proofOptions(process.argv.slice(2))` and a temporary destination. Check
   exported decisions with representative inputs. Wire `check.ts --proof` into
   the owner's Linux workflow. Update existing build and publication input
   declarations for all consumers of the source, owner build and shared compiler.
   Pre-push discovers registered owners and runs their check for affected paths.

The staged hook reads Git blobs offline. It requires regular non-executable
manifests, sources and owner entrypoints, enforces the 4,000-token source budget
and comment rule, and permits only `import Base`. The compiler isolates each
source. `capture/` remains a frozen migration source.

Production builds use Node 22 and verify the pinned compiler and Base by
SHA-256. Verification uses Bun 1.3.10. On Linux x64, `--proof` provisions
checksum-verified Lean 4.34.0 for the pinned BendTT kernel. Use
`--lean-bin /absolute/path/to/lean/bin` with an existing Lean 4.34.0 installation.
Authors need network access to fetch the pinned tools. Shipped JavaScript needs
neither Bun nor Lean. Owners without modules have no Bend toolchain setup.

| Owner or runtime | Integration |
| --- | --- |
| Record | Node completion package and installed Desktop completion worker |
| Other canonical owners, Shared, Composition and Enablement | Can add a manifest and wire the same contract to an existing JavaScript build and runtime |
| Native Rust or Swift and Hermes Python | Require a supported host integration before adopting Bend. The emitted module is JavaScript. |
