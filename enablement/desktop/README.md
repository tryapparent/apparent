# Development desktop bundle

Run `node --experimental-strip-types enablement/desktop/build-dev-app.ts --help` from the repository root. The command wraps the accepted `composition/app/scripts/build-omarchy.ts` builder; it is not a second assembly implementation.

Build with explicit, privately held admitted input and a new output directory:

```sh
node --experimental-strip-types enablement/desktop/build-dev-app.ts \
  --inputs /absolute/path/admitted-native-inputs.json \
  --output /absolute/path/apparent-dev-bundle
```

The result is under `OUTPUT/apparent-omarchy/`, including its launcher and packaged app. Use `--plan` to check source discovery and print the build prerequisites without starting subprocesses. If this branch does not yet contain the builder, pass `--source-root /path/to/accepted/checkout`; that source is read-only to this tool. The builder enforces its clean committed source requirement and refuses an existing output directory. Do not pass an installed app or evidence directory as output.

Requirements are Linux x64, Node 22+ and the builder checkout's already installed dependencies. Inputs must have been admitted by their producer; this CLI does not build native artifacts or establish their provenance. A full real desktop requires the GUI AppImage closure in addition to Capture, Media and config. Inputs without that GUI are rejected as incomplete by the builder; the CLI never substitutes a synthetic shell. Build/package success is not native desktop acceptance. The command does not install, activate or launch the bundle.

Focused contracts: `node --test enablement/desktop/build-dev-app.test.ts`.
