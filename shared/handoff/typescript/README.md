# Config transactions

This package is the low-level durable JSON executor shared by native and
TypeScript owners. It defines no Connect, Storage, consent or activation policy.
Owners validate their own intent; native callers temporarily retain the existing
closure/CAS API through `shared/handoff/config_store/actor.rs`.

`updateConfig` pins the trusted parent, locks the private sidecar with POSIX
`flock`, reads a fresh object and preserves untouched JSON values. A successful
write means file fsync, rename and directory fsync all completed. Errors after
rename have `published: true`, including an unchanged-value write whose directory
sync failed. They are outcome unknown, never a safe invitation to replay. A
cancelled admission before publication writes nothing. Callers that also need a
queue lock acquire queue first; this executor never accesses a queue or network.

The private `rpc.cjs` process handles one native transaction over inherited pipes.
Version 1 accepts a raw POSIX path, admission checks and leaf set/remove patches
against its locked snapshot. It exposes no socket, renderer or generic command
endpoint. Secrets stay on the private pipe; errors contain only fixed codes.
All legacy config writer entry points delegate here together. Do not add an
independent Node read/modify/write or restore a second physical writer.

Development uses Node 22.18+ (or the existing development Electron runtime):

```sh
node shared/handoff/typescript/scripts/prepare.ts
npm --prefix shared/handoff/typescript test
```

Pass `--offline` to preparation when the locked npm packages are already cached.
Preparation is explicit, never a Cargo build hook or npm install lifecycle hook.
Installation, typecheck, build, tests and pack require no Cargo, rustc or cached
Rust output. Native consumer checks still require their actual native backend.

Installed apps stage `settings/app/shared-config` beside the existing Settings
Electron distribution. A fixed-symbol Node-API binding supplies `openat`,
`renameat`, `unlinkat` and `flock`; only the locked platform prebuilt is deployed,
without the dependency's source builder or main loader. Supported adapters are
Linux glibc and macOS, x64/arm64. macOS packaging signs the staged native binding
with the same supplied app identity. Changes to that adapter require real affected
platform evidence; Linux tests do not establish Darwin ABI or signing behavior.

Stream policy, native credential/queue ownership, legacy CLI consumers and their
remaining migration are separate from this transaction mechanism. This package
does not by itself complete Connect's Rust removal.
