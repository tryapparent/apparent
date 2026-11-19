import { execFileSync } from "node:child_process";
import {
  closeSync,
  openSync,
  readSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { markElectronAccessory } from "./metadata.ts";

const tooling = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const root = process.env.APPARENT_SOURCE_ROOT ?? tooling;
const frontend = join(root, "capture/desktop/ui/frontend");
const connect = join(root, "connect/client/typescript");
export function run(command: string, args: string[], cwd = root) {
  return execFileSync(command, args, { cwd, stdio: "inherit" });
}
function copy(source: string, destination: string) {
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, verbatimSymlinks: true });
}
export function stagePortable(
  destination: string,
  sourceRoot = root,
  execute = run,
) {
  const frontend = join(sourceRoot, "capture/desktop/ui/frontend");
  const connect = join(sourceRoot, "connect/client/typescript");
  if (existsSync(destination))
    throw Error("Portable destination already exists");
  const app = join(destination, "app");
  mkdirSync(app, { recursive: true });
  copy(join(frontend, "electron"), join(app, "electron"));
  for (const owner of ["pill", "record-media", "agent-media"])
    rmSync(join(app, "electron", owner, "native"), {
      recursive: true,
      force: true,
    });
  copy(join(frontend, "dist"), join(app, "dist"));
  copy(
    join(frontend, "dist/src/installer/index.html"),
    join(app, "electron/installer/ui/src/installer/index.html"),
  );
  copy(
    join(frontend, "dist/assets"),
    join(app, "electron/installer/ui/assets"),
  );
  for (const name of ["window-theme.cjs", "tokens.css"])
    copy(
      join(sourceRoot, "shared/ui/src", name),
      join(app, "node_modules/@apparent/ui/src", name),
    );
  writeFileSync(
    join(app, "node_modules/@apparent/ui/package.json"),
    JSON.stringify({ exports: { "./window-theme": "./src/window-theme.cjs" } }),
  );
  copy(join(connect, "dist"), join(app, "connect-client/dist"));
  writeFileSync(
    join(app, "connect-client/package.json"),
    '{"type":"module"}\n',
  );
  writeFileSync(
    join(app, "package.json"),
    '{"name":"apparent-settings","version":"0.0.0","main":"electron/settings.cjs"}\n',
  );
  execute(
    process.execPath,
    [
      "-e",
      `
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
for (const name of ['main', 'preload']) {
 const file = path.join('electron/installer', name + '.cts');
 const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
 if (result.diagnostics?.length) throw Error('Installer host transpilation failed');
 fs.writeFileSync(path.join(process.argv[1], name + '.cjs'), result.outputText);
}`,
      join(app, "electron/installer"),
    ],
    frontend,
  );
  writeFileSync(
    join(destination, "source-sha"),
    process.env.CANDIDATE_SHA + "\n",
  );
}
function descendants(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const file = join(directory, name),
      stat = lstatSync(file);
    return stat.isSymbolicLink()
      ? []
      : stat.isDirectory()
        ? [...descendants(file), file]
        : [file];
  });
}
export function signRuntime(
  runtime: string,
  sign: string[],
  entitlements: string,
) {
  const files = descendants(runtime);
  const bundles = [
    ...files.filter(
      (file) =>
        lstatSync(file).isDirectory() && /\.(app|framework)$/.test(file),
    ),
    runtime,
  ];
  const executables = new Set(
    bundles.map((bundle) => {
      const app = bundle.endsWith(".app");
      const plist = JSON.parse(
        execFileSync(
          "plutil",
          [
            "-convert",
            "json",
            "-o",
            "-",
            join(bundle, app ? "Contents/Info.plist" : "Resources/Info.plist"),
          ],
          { encoding: "utf8" },
        ),
      );
      const name =
        plist.CFBundleExecutable ??
        bundle
          .split("/")
          .pop()!
          .replace(/\.[^.]+$/, "");
      return realpathSync(join(bundle, app ? "Contents/MacOS" : "", name));
    }),
  );
  const magic = new Set([
    "feedface",
    "cefaedfe",
    "feedfacf",
    "cffaedfe",
    "cafebabe",
    "bebafeca",
  ]);
  for (const file of files.filter((file) => lstatSync(file).isFile())) {
    const canonical = realpathSync(file);
    if (executables.has(canonical)) continue;
    const descriptor = openSync(file, "r"),
      header = Buffer.alloc(4);
    try {
      readSync(descriptor, header, 0, 4, 0);
    } finally {
      closeSync(descriptor);
    }
    if (magic.has(header.toString("hex")))
      run("codesign", [...sign, "--entitlements", entitlements, file]);
  }
  for (const bundle of bundles.sort(
    (a, b) => b.split("/").length - a.split("/").length,
  ))
    run("codesign", [...sign, "--entitlements", entitlements, bundle]);
  run("codesign", ["--verify", "--deep", "--strict", runtime]);
}
export function stageNative(prepared: string, destination: string) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw Error("An ARM Mac is required");
  if (
    readFileSync(join(prepared, "source-sha"), "utf8").trim() !==
    process.env.CANDIDATE_SHA
  )
    throw Error("Prepared source differs");
  if (existsSync(destination))
    throw Error("Settings destination already exists");
  const identity = process.env.APPARENT_APPLE_SIGNING_IDENTITY;
  const keychain = process.env.APPARENT_APPLE_SIGNING_DIR;
  if (!identity || !keychain) throw Error("Signing credentials required");
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], frontend);
  run(process.execPath, ["node_modules/electron/install.js"], frontend);
  for (const script of [
    "build-pill-native.ts",
    "build-record-media.ts",
    "agent-media/build.ts",
  ])
    run(
      process.execPath,
      ["--experimental-strip-types", `scripts/${script}`],
      frontend,
    );
  copy(join(prepared, "app"), join(destination, "app"));
  for (const owner of ["pill", "record-media", "agent-media"])
    copy(
      join(frontend, "electron", owner, "native"),
      join(destination, "app/electron", owner, "native"),
    );
  copy(
    join(frontend, "node_modules/electron/dist"),
    join(destination, "runtime"),
  );
  const sign = [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    identity,
    "--keychain",
    join(keychain, "signing.keychain-db"),
  ];
  for (const owner of ["pill", "record-media", "agent-media"]) {
    for (const file of descendants(
      join(destination, "app/electron", owner, "native"),
    )) {
      if (
        !lstatSync(file).isFile() ||
        (!file.endsWith(".node") &&
          !file.split("/").pop()!.startsWith("apparent-engine-"))
      )
        continue;
      run("codesign", [...sign, file]);
      run("codesign", ["--verify", "--strict", file]);
    }
  }
  const runtime = join(destination, "runtime/Electron.app");
  markElectronAccessory(runtime);
  signRuntime(
    runtime,
    sign,
    join(root, "capture/desktop/scripts/packaging/Settings.entitlements"),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, destination, extra] = process.argv.slice(2);
  if (command === "prepare" && destination && !extra) {
    if (process.platform !== "linux")
      throw Error("Portable preparation requires Linux");
    process.env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    for (const directory of [frontend, connect]) {
      run(
        "npm",
        ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
        directory,
      );
      run("npm", ["run", "build"], directory);
    }
    stagePortable(resolve(destination));
  } else if (command === "stage" && destination && extra)
    stageNative(resolve(destination), resolve(extra));
  else throw Error("Use prepare DIRECTORY or stage PREPARED DESTINATION");
}
