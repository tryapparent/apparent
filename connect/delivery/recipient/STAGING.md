Stage during package construction with Node 22 and authenticated `gh` plus `tar` installed:

```
node --experimental-strip-types connect/delivery/recipient/stage.ts /absolute/reviewed-pin.json x86_64-unknown-linux-gnu /absolute/package/recipient
```

The destination must not exist; its ancestors must not be symlinks. The package receives `apparent-connect-recipient` (0755) and `manifest.json`. No runtime PATH lookup or source build occurs. Failed downloads, provenance checks or validation leave no published destination. Use a trusted package directory without concurrent writers.

The reviewed JSON pin contains `sourceSha` (40 lowercase hex), `run` and `attempt` (positive decimal strings), `target`, `sha256` (binary digest), `version` (`recipient-SHA-RUN-ATTEMPT`), and `manifest`: `{ "schema": 1, "protocol": 1, "repository": "tryapparent/apparent", "workflow": ".github/workflows/connect-delivery.yml", "executable": "apparent-connect-recipient" }`. Obtain these from the completed trusted producer; never infer a pin from downloaded assets. No real release pin is included here.

Both extracted files must pass GitHub attestation verification for the trusted workflow, main source ref and pinned source digest before binary architecture, digest and manifest identity validation. Tests use synthetic headers and injected transport/attestation results; they do not establish real producer provenance.

Run tests: `node --experimental-strip-types --test connect/delivery/recipient/*.test.ts`.

Packaging preparation: all four assembly routes consume `pins.json` through
`package.ts`. `adopted:false` preserves current production assembly. Adoption
requires all four reviewed real pins together; missing pins then fail closed.
Keep this integration unmerged until producer execution and native proof pass.
Mac assembly signs the nested recipient before the enclosing app. The original
attested manifest is retained as `recipient-provenance.json`; `manifest.json`
contains the signed executable digest. Linux adoption MUST bind the raw producer digest in the trusted adapter
argument. Mac adoption authenticates the signed receipt through the enclosing
app signature as described below; an adjacent manifest alone is insufficient. Current production dispatch remains unchanged. This is still an open
integration gate; raw producer hashes cannot be used as signed output hashes.
No recipient updater or runtime download is introduced.

Assembly publishes `recipient/` beside the root executable (on Mac,
`Contents/MacOS/recipient/`). Signing and strict nested verification complete in
a private same-destination staging directory before directory rename; failure
removes staging. Existing output is refused. Ancestors and concurrent writers
must remain trusted throughout assembly.

The staged Mac adapter accepts a receipt only inside the running app's canonical
bundle, after `/usr/bin/codesign --verify --strict --deep` on the enclosing app,
running executable and recipient. Their nonempty TeamIdentifiers must agree.
The enclosing signature must seal `recipient/manifest.json` and the retained
provenance. The receipt digest then binds the signed executable bytes. Linux
continues to require a trusted compiled raw digest argument; no real pin exists.
Injected assembly tests and Linux Rust tests do not prove Mac resource sealing
or packaged signature behavior. Parent-owned packaged Mac proof must verify
receipt mutation rejection, wrong-team rejection and successful invocation before
adoption. Production dispatch and `adopted:false` remain unchanged.

For retry assembly, an optional reviewed `releaseVersion` locates the release tag
and exact target archive. It must name the same source SHA and run with an attempt
at least as new as the producer `attempt`. The manifest `version` and producer
attempt remain original. `recipient-identities.json` is untrusted inventory for
reviewing candidate identities; it never supplies authority or automatically
updates a trusted pin. The reviewed pin remains authoritative.

The root adapter test accepts an explicit private fixture path through
`APPARENT_TEST_RECIPIENT_EXECUTABLE`; it copies that executable beside a synthetic
root path outside the checkout and invokes the real adapter. This test-only input
never changes runtime resolution or PATH.
