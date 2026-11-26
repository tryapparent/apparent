# CLI workflow tracing

The Linux and macOS CLI can time the commands in a local video workflow.
Enable **CLI workflow tracing** in Settings → Labs. It is off by default.
The preference applies to the next CLI invocation and needs no restart.
For an isolated CLI-only profile, set `APPARENT_CONFIG` to an absolute config
path in a private directory and use `apparent settings set labs.videoTracing true`.

```sh
trace_id=$(apparent trace start)
apparent --trace "$trace_id" video inspect synthetic.mp4 --out review
apparent --trace "$trace_id" frames "$bundle" --from 0 --to 2
apparent trace end "$trace_id"
apparent trace report "$trace_id"
```

Use `capture`, `demo`, `import`, `inspect`, `frames`, `zoom`, `export` or
`video` with `--trace`. The flag is explicit for each command. It works before
or after the subcommand. Trace admission runs before the selected operation
and reports an error if the trace is unavailable, closed or full. Commands
without the flag run normally. A trace records up to 256 command attempts.
Start a new trace when one fills.

Each attempt stores the canonical command name, CLI build, start time and
elapsed milliseconds. The completion shows whether the command succeeded.
For capture requests, the duration measures the CLI request, which can return
before the recording or bundle is ready. A null result means no completion
was recorded, for example after interruption. If a completion cannot be
saved, Apparent warns on stderr and preserves the command's actual outcome.
Ending a trace prevents new attempts and allows already admitted attempts to
finish. You can read and end existing traces after turning the preference off.

The store is `workflow-traces/` beside the CLI configuration file. It contains
private JSON reports. The recorder does not include command arguments, output,
errors, file paths, capture IDs, transcripts or images in those reports. It
does not send reports or add them to bundles. The underlying traced command
still runs as requested. Retain or remove your own reports as needed.

## Verification

Run the shipped or development executable against the synthetic smoke case.

```sh
node agent/trace/verify.ts /absolute/path/to/apparent
```

The check requires Node 22 and FFmpeg. It uses a disposable configuration and
does not open a recorder or change the real profile. Set `TMPDIR` to the private
job directory on Clanker. Revert the native bridge, Bend admission policy and
Labs registration together to roll back. Existing trace directories are
ordinary JSON data and need no migration.
