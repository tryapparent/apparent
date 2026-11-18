# Record Bend build and verification

Use Node 22.23 and Bun 1.3.10. From the repository root, run:

```sh
node record/enablement/ci/bend/check.ts
```

The command checks tracked Bend files and runs the installed worker entrypoint against the production-generated admission module. It checks all eight admission decisions with the Node build and Bun proof paths. The normal Record and Desktop builds use `build.ts` to compile `record/completion/src/copy-admission.bend` to standalone JavaScript. Builds need access to `raw.githubusercontent.com` and verify every compiler source against its SHA-256 before execution. The application ships the generated module with the worker. Bun and Lean are verification tools.

Add or edit regular `.bend` source under `record/completion/` or `record/enablement/ci/bend/`. The staged hook applies the 4,000-token source limit, the existing comment rule and the `import Base` boundary. That hook runs without Bun or a download. Pre-push runs the compiler check for affected paths. The Linux Record workflow also verifies the kernel verdict for those inputs. Production Bend and compiler changes select the Desktop build and release inputs.

To reproduce CI on Linux x64, run `node record/enablement/ci/bend/check.ts --proof`. It downloads the official [Lean 4.34.0](https://github.com/leanprover/lean4/releases/tag/v4.34.0) archive, verifies its SHA-256 and builds the pinned BendTT kernel. With an existing Lean installation, use its absolute binary directory:

```sh
node record/enablement/ci/bend/check.ts --lean-bin /absolute/path/to/lean/bin
```

Pre-push skips the Lean download and kernel build to keep local feedback fast. The stale-capture law covers the pure policy decision. Record's host still owns the freshness observation and final check before writing to the clipboard.
