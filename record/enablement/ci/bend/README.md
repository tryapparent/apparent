# Record Bend pilot

Use Node 22.23 and Bun 1.3.10. From the repository root, run:

```sh
node record/enablement/ci/bend/check.ts
```

The command checks and compiles tracked Bend files in the pilot and exercises the generated completion module with Node against Record's existing TypeScript decisions. The runtime module is standalone JavaScript. Generated files and downloaded compiler sources stay in disposable storage. The exact compiler revision and SHA-256 of each source are checked before execution. Setup needs access to `raw.githubusercontent.com`. Compiler telemetry and external Bend package imports are disabled.

Add or edit regular `.bend` source under `record/completion/` or `record/enablement/ci/bend/`. The staged hook applies the 4,000-token source limit, the existing comment rule and the pilot's `import Base` boundary. That hook runs without Bun or a download. Pre-push runs the compiler check for affected paths. The Linux Record workflow also verifies the kernel verdict for those inputs. Other streams and the installed completion worker do not acquire a Bend runtime dependency.

To reproduce CI on Linux x64, run `node record/enablement/ci/bend/check.ts --proof`. It downloads the official [Lean 4.34.0](https://github.com/leanprover/lean4/releases/tag/v4.34.0) archive, verifies its SHA-256 and builds the pinned BendTT kernel. With an existing Lean installation, use its absolute binary directory:

```sh
node record/enablement/ci/bend/check.ts --lean-bin /absolute/path/to/lean/bin
```

Pre-push skips the Lean download and kernel build to keep local feedback fast. The stale-capture law covers the pure policy decision. Record's host still owns the freshness observation and final check before writing to the clipboard.
