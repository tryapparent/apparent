# Settings contract verification

Native builds use `node enablement/ci/settings-contract/emit.ts` to assemble the owner catalogs with no npm dependencies. Catalog paths are declared in `catalog.ts`. The combined list validates pane names, IDs, value metadata and aliases before it reaches the build.

After installing the pinned parser tools with `npm ci --ignore-scripts --prefix shared/enablement/dependency-policy`, run these commands from the repository root.

```sh
node --experimental-strip-types --test enablement/local-tests/settings-contract.test.ts
node --experimental-strip-types enablement/ci/settings-contract/check.ts
```

The checker inventories live Rust and TypeScript/JavaScript source. It checks literal preference IDs, the Labs action map, direct calls to known config mutation functions, and common legacy flag reads. It resolves simple same-file string constants. Legacy write allowances match the file, containing function, write function and literal path where available. Remove an allowance when its call is retired. The PR check and pre-push check compare the allowance inventory with their base to enforce that it only shrinks.

The checker covers direct syntax. Indirect calls, dynamic key construction and reads through data projected by another runtime require owner contract and integration tests.


Start a saved preference in its owner’s `settings/preferences.json`. Regenerate
the renderer types with
`node enablement/ci/settings-contract/emit.ts --types > shared/settings/preference-ids.ts`.
Attach `bindPreference(pane, id, change)` to the control or its owner adapter.
Reuse the same binding ID for alternate controls that save the same value. An
existing runtime-only microphone preference is also discoverable through the CLI.

Add a representative saved value by canonical ID in
`shared/settings/roundtrip.json`. The required Settings check compares
the generated IDs against the catalogs and runs the Bend2 coverage policy.
The full native suite writes, reads and resets every sample through the
shared config transaction. Its rebuilt CLI check verifies discovery for every
ID and exercises set and reset for available preferences without a custom effect.
Owner tests cover native effects, destructive confirmation, and the effective
runtime value when it depends on the platform or a provider.

The remaining Labs and Agents renderer donors can import the public binding
helper while those panes move out of `capture/`. This dependency exception
covers those two files and the helper export.
