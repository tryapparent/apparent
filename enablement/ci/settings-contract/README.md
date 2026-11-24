# Settings contract verification

Native builds use `node enablement/ci/settings-contract/emit.ts` to assemble the owner catalogs with no npm dependencies. Catalog paths are declared in `catalog.ts`. The combined list validates pane names, IDs, value metadata and aliases before it reaches the build.

After installing the pinned parser tools with `npm ci --ignore-scripts --prefix shared/enablement/dependency-policy`, run these commands from the repository root.

```sh
node --experimental-strip-types --test enablement/ci/settings-contract/check.test.ts
node --experimental-strip-types enablement/ci/settings-contract/check.ts
```

The checker inventories live Rust and TypeScript/JavaScript source. It checks literal preference IDs, the Labs action map, direct calls to known config mutation functions, and common legacy flag reads. It resolves simple same-file string constants. Legacy write allowances match the file, containing function, write function and literal path where available. Remove an allowance when its call is retired. The PR check and pre-push check compare the allowance inventory with their base to enforce that it only shrinks.

The checker covers direct syntax. Indirect calls, dynamic key construction and reads through data projected by another runtime require owner contract and integration tests.
