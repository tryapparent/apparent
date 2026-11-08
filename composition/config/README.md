# Owner config host

This privileged TypeScript client binds a single owner and an explicitly supplied
native artifact to the API in `@apparent/app-contracts/host`. It stages the verified
bytes in a fresh private directory and runs that copy, then removes it on close.
Replacing the admitted source path cannot change the executable being launched.
It never opens the
configuration file, invokes Cargo, searches PATH or installs a provider. The
native resource uses the same transaction implementation and sidecar lock as
existing application writers, preserving unrelated settings and secrets.

Composition supplies a verified artifact path/hash and config path, then binds
the stream's own codec with `bindOwnerProgress(backend, ownerId, codec)`. Only
that narrow facade may cross a renderer boundary. No generic filesystem or IPC
API is exposed. The new `streamState` envelope is host metadata; stream schema,
legacy interpretation and journey decisions remain owner-owned.

Requests are serialized, bounded and correlated. A lost write reply is `unknown`;
there is no automatic retry or guessed success. After transport failure, close
the backend, construct a new one and read persisted state before deciding what
to do next. Shutdown closes the child process; it does not cancel Engine capture.

First run `npm --prefix shared/contracts ci` from the repository root to build
the linked contract package. In this directory, run `npm ci`, `npm run typecheck`
and `npm test` without Rust. Native producer
verification additionally sets `APPARENT_CONFIG_HOST_BIN` to the exact staged
executable and runs `npm run test:native`. A passing transport fixture is not
native durability or installed-app evidence. This package does not install a
preload bridge, select an installed route, implement coaching windows or provide
Record/Engine capabilities.

Record's bounded legacy setting facade is `createRecordPenColorConfig({ executable,
executableSha256, configPath })`. It returns `read()` and presence/value
`compareAndSwap(expected, next)`, plus `close()`. Both the owner (`record`) and
top-level key (`penColor`) are compiled into the facade and protocol; callers
cannot choose another key. Missing differs from stored null. CAS compares the
exact presence/value under the same native writer lock and returns fresh current
value on conflict. Values are limited to 16 KiB of JSON. This is a privileged
composition API; do not pass the unrestricted host client into a renderer. A
transport loss or durability uncertainty returns `unknown`; close, recreate and
read before deciding whether to write again.

```ts
const penColorConfig = await createRecordPenColorConfig({
  executable: admittedConfigHost.path,
  executableSha256: admittedConfigHost.sha256,
  configPath: userConfigPath,
});
const current = await penColorConfig.read();
const result = await penColorConfig.compareAndSwap(current, { present: true, value: '#336699' });
```


For first adoption, `backend.readForAdoption(ownerId)` atomically returns
`{owner:{present,revision,value},legacy:{present,value}}`. The legacy key is
exactly the bound owner ID (for example top-level `onboarding`), not an arbitrary
renderer-selected key. Presence distinguishes a missing value from stored null.
The owner interprets that legacy snapshot and encodes its own schema, then calls
`backend.adoptLegacy(ownerId, snapshot.legacy, encodedValue)`. The same native
writer lock checks that the owner entry is still absent and legacy presence/value
are unchanged before creating revision 1. Otherwise it returns
`{status:'conflict',snapshot}` without rewriting. Existing legacy keys, secrets
and other owners remain intact. An uncertain result requires a fresh read.

Example privileged assembly (owner policy functions are supplied by Onboarding):

```ts
import { adoptOnboardingProgress } from '@apparent/onboarding';

const result = await adoptOnboardingProgress(backend); // owner codec and repair policy
if (result.status === 'ready') {
  // Required when the owner entry predated adoption. New adoption atomically
  // writes this same fence together with revision 1.
  if (result.source === 'existing') {
    const retired = await backend.retireOnboardingLegacyWriter();
    if (retired.status !== 'retired') throw new Error('Onboarding writer ownership is unknown');
  }
  const store = bindOwnerProgress(backend, 'onboarding', codec);
}
```

The initial snapshot is only a decode input. The adoption transaction compares
its exact presence/value under the config writer lock, writes owner revision 1,
and writes an explicit `onboardingLegacyWriter: {schema: 1, state: "retired"}`
marker in the same atomic publication. Legacy `Progress::save` uses that same
writer transaction and refuses to change the top-level key after the marker,
including late callbacks and later process restarts. If an owner entry already
exists, privileged assembly must explicitly call `retireOnboardingLegacyWriter()`
before activating it; an unknown result refuses activation. The operation is
bound to the onboarding owner binding and changes no other config writer. The
marker is an explicit ownership record, never inferred from config presence.
This API does not switch an installed route or silently migrate at read time.
Legacy bytes remain for an explicit rollback/migration window; removal is a
separate owner-approved step.

The fence is enforced by writers built with this native config implementation.
An older running GUI binary does not understand the marker. Production assembly
must establish that the legacy journey writer has been upgraded to this fence
(or stopped) before relying on retirement; a successful helper call alone does
not qualify an old GUI. This prerequisite does not upgrade or stop installed
applications. Host activation must retain that writer-version/identity gate.

Connect's fixed cloud-group storage is exported as compiled ESM and declarations
from `@apparent/config-host/cloud`:

```ts
import { createConnectCloudConfig } from '@apparent/config-host/cloud';
const cloud = await createConnectCloudConfig({
  executable: admittedConfigHost.path,
  executableSha256: admittedConfigHost.sha256,
  configPath: userConfigPath,
});
const observed = await cloud.read();
// Connect validates/interprets observed.value and constructs the next opaque group.
const result = await cloud.compareAndSwap(observed, nextCloudSnapshot);
await cloud.close();
```

`read()` returns `{present,value}` for the top-level `cloud` key only. Missing is
distinct from present null. `compareAndSwap(expected,next)` compares that entire
presence/value under the existing config transaction and sidecar lock, returning
`{status:'saved'}`, `{status:'conflict',current}`, or `{status:'unknown',message}`.
Read and conflict do not rewrite the config. Matching CAS republishes even an
unchanged value, so a caller can explicitly settle a previously uncertain
publication after reading it. The facade never retries automatically.

Owner `connect` and key `cloud` are fixed; there is no arbitrary key selector.
Native storage preserves every value outside `cloud`. Connect must preserve
server, unknown fields and secrets within the opaque next cloud value it supplies;
the helper does not merge fields, interpret consent, select a server, implement
logout, alter credentials or switch the live writer. Existing JSON validation
and the 16,384-byte serialized JSON value limit apply to both expected and next
(`MAX_CONNECT_CLOUD_VALUE_BYTES`). The complete UTF-8 JSON protocol frame is
bounded to 65,536 bytes including LF. A publication or lost-reply uncertainty
requires reconciliation, never inferred no-effect or an automatic second write.
Keep Connect's existing lock order, sole-writer transition and admission policy.

The compiled package requires Node >=22.18 and the paired
`@apparent/app-contracts@0.1.0` peer tarball. The cloud declaration graph uses only
`@apparent/app-contracts/native`; React is optional and is not installed for this
headless consumer. `npm run test:packed` tests a normal paired tar installation,
plain Node import, strict declarations without React ambient types and transport
cases while compiler/native build tools are denied during install and runtime.
It does not prove native filesystem effects. Both registered `platform-config`
native producers run the public compiled cloud adapter against their exact staged
helper; production admission still requires their receipt and artifact identity.
