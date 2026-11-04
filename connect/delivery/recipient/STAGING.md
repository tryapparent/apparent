Stage during package construction with Node 22 and authenticated `gh` plus `tar` installed:

```
node --experimental-strip-types connect/delivery/recipient/stage.ts /absolute/reviewed-pin.json x86_64-unknown-linux-gnu /absolute/package/recipient
```

The destination must not exist; its ancestors must not be symlinks. The package receives `apparent-connect-recipient` (0755) and `manifest.json`. No runtime PATH lookup or source build occurs. Failed downloads, provenance checks or validation leave no published destination. Use a trusted package directory without concurrent writers.

The reviewed JSON pin contains `sourceSha` (40 lowercase hex), `run` and `attempt` (positive decimal strings), `target`, `sha256` (binary digest), `version` (`recipient-SHA-RUN-ATTEMPT`), and `manifest`: `{ "schema": 1, "protocol": 1, "repository": "tryapparent/apparent", "workflow": ".github/workflows/connect-delivery.yml", "executable": "apparent-connect-recipient" }`. Obtain these from the completed trusted producer; never infer a pin from downloaded assets. No real release pin is included here.

Both extracted files must pass GitHub attestation verification for the trusted workflow, main source ref and pinned source digest before binary architecture, digest and manifest identity validation. Tests use synthetic headers and injected transport/attestation results; they do not establish real producer provenance.

Run tests: `node --experimental-strip-types --test connect/delivery/recipient/*.test.ts`.
