import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lstatSync, mkdirSync } from 'node:fs';

// Keep the existing Electron/main and package consumer path. Authored source is
// TypeScript; emitted CommonJS is a build artifact and has no Rust prerequisite.
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
execFileSync(process.execPath, [path.resolve(root, '../../../../connect/enablement/ci/bend/settings.ts')], { stdio: 'inherit' });
const program = ts.createProgram([`${root}/electron/settings/frame.cts`, `${root}/electron/settings/t3.ts`, `${root}/src/settings/agents/policy.ts`, `${root}/src/settings/labs/policy.ts`, `${root}/tests/settings/agents/parent.cts`, `${root}/electron/settings/general.ts`], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
  types: ['node'],
  typeRoots: [`${root}/node_modules/@types`],
  rewriteRelativeImportExtensions: true,
  noEmitOnError: true,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: file => file,
    getNewLine: () => '\n',
  }));
}
if (program.emit(undefined, (file, content) => {
  if (file === `${root}/electron/settings/general.js`) ts.sys.writeFile(`${root}/electron/settings/general.cjs`, content);
  // Type-only renderer contracts participate in checking, never runtime output.

  if (file === `${root}/src/settings/agents/policy.js`) ts.sys.writeFile(`${root}/electron/settings/agents.cjs`, content);

  if (file === `${root}/tests/settings/agents/parent.cjs`) ts.sys.writeFile(file,content);
  if (file === `${root}/src/settings/labs/policy.js`) ts.sys.writeFile(`${root}/electron/settings/labs.cjs`, content);
}).emitSkipped) throw Error('Connect transport emission failed');

await build({
  stdin: {
    contents: "export * from './electron/connect.cts'; export * from '../../../../connect/native-adapter/src/settings.ts';",
    resolveDir: root,
  },
  outfile: `${root}/electron/connect.cjs`, bundle: true, platform: 'node', format: 'cjs', target: 'node22',
});

execFileSync(process.execPath, [path.resolve(root, '../../../../record/settings/build.ts')], { stdio: 'inherit' });
await build({entryPoints:[`${root}/electron/settings/frame.cts`],outfile:`${root}/electron/settings/frame.cjs`,bundle:true,platform:'node',format:'cjs',target:'node22'});

await build({entryPoints:[`${root}/electron/settings/t3.ts`],outfile:`${root}/electron/settings/t3.cjs`,bundle:true,platform:'node',format:'cjs',target:'node22'});

// Native composition checks use an unchanged prebuilt Node host. Prepare its
// Connect-owned policy without requiring a Rust build or the crypto dependency
// graph. The owner's normal build still emits/checks its complete package.
const client = path.resolve(root, '../../../../connect/client/typescript');
const output = path.join(client, 'dist');
for (const entry of [output, path.join(output, 'shares.js')]) {
  try {
    const stat = lstatSync(entry);
    if (stat.isSymbolicLink() || (entry === output ? !stat.isDirectory() : !stat.isFile())) throw Error('Unsafe shares build output');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
const shares = ts.createProgram([path.join(client, 'src/shares.ts')], {
  target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext, strict: true,
  skipLibCheck: true, types: ['node'], typeRoots: [`${root}/node_modules/@types`],
  rootDir: path.join(client, 'src'), outDir: output, noEmitOnError: true,
});
const errors = ts.getPreEmitDiagnostics(shares);
if (errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(errors, {
  getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n',
}));
mkdirSync(output, { recursive: true });
if (shares.emit(undefined, (file, content) => {
  if (file === path.join(output, 'shares.js')) ts.sys.writeFile(file, content);
}).emitSkipped) throw Error('Connect shares emission failed');
