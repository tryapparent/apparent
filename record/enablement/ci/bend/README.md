# Record Bend build and verification

Use Node 22.23 and Bun 1.3.10. From the repository root, run:

```sh
node record/enablement/ci/bend/check.ts
```

The command checks the modules declared in `modules.json` and runs the installed worker entrypoint against the production-generated admission module. It checks all eight admission decisions with the Node build and Bun proof paths. The normal Record and Desktop builds use `build.ts` to compile `record/completion/src/copy-admission.bend` to standalone JavaScript. Builds need access to `raw.githubusercontent.com` and verify every compiler source against its SHA-256 before execution. The application ships the generated module with the worker. Bun and Lean are verification tools.

Follow the [shared Bend build contract](../../../../shared/enablement/bend/README.md) to add a module. Affected pre-push checks verify the declarations and policy. The Linux Record workflow also verifies the kernel verdict. Production Bend and compiler changes select the Desktop build and release inputs.

To reproduce CI on Linux x64, run `node record/enablement/ci/bend/check.ts --proof`. It downloads the official [Lean 4.34.0](https://github.com/leanprover/lean4/releases/tag/v4.34.0) archive, verifies its SHA-256 and builds the pinned BendTT kernel. With an existing Lean installation, use its absolute binary directory:

```sh
node record/enablement/ci/bend/check.ts --lean-bin /absolute/path/to/lean/bin
```

Pre-push skips the Lean download and kernel build to keep local feedback fast. The stale-capture law covers the pure policy decision. Record's host still owns the freshness observation and final check before writing to the clipboard.
