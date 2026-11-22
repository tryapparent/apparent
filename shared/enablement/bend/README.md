# Bend2 owner builds

Record completion and the Connect service build typed Bend2 policy into standalone
ES modules. The [migration rule](../../../AGENTS.md#architecture-and-migration)
requires new or changed decisions, validation, transformations and state
transitions to move to Bend2 with their callers, tests and production build
integration in the same PR.

Move Rust policy directly into Bend2 and wire the production caller through a
supported host. Move touched pure TypeScript policy into Bend2 and call the
generated module from the existing TypeScript host. For a pure-policy repair,
migrate the smallest affected function or module and replace its old decision path.

Keep React rendering, TypeScript host and effect glue, and build tooling in the
existing stack. Keep capture execution, native resource handling, durability and
safety in native adapters. Repair host or native mechanics in the language those
mechanics require. If a runtime, platform or integration requirement blocks a
migration, identify the production caller, the specific constraint and the
behavior it prevents moving. Add missing build and host wiring in the same PR
when the runtime supports it.

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

Handoff and Connect declare suite consumers in `consumers.json` beside
`modules.json`. Each key is a repository-relative path. An exact match wins,
then the longest directory prefix for non-Markdown files. Every registered
module needs a nonempty route. The proof entrypoint and stream workflow may
declare an empty route when they only verify. Manifest edits select the union
of module consumers. Routing declaration edits widen to all supported targets,
including consumers removed by the edit. The hook checks declarations against
staged modules. CI and pre-push use the same routes for suites and packaging.

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
| Connect | Standalone service and bundled Cloudflare gateway |
| Other canonical owners, Shared, Composition and Enablement | Can add a manifest and wire the same contract to an existing JavaScript build and runtime |
| Native Rust or Swift and Hermes Python | Route the decision through a supported host that can execute the emitted JavaScript. Verify the real caller and packaged runtime. |
