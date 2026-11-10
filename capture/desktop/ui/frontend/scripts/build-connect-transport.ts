import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lstat, rm } from 'node:fs/promises';

// Keep the existing Electron/main and package consumer path. Authored source is
// TypeScript; emitted CommonJS is a build artifact and has no Rust prerequisite.
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const program = ts.createProgram([`${root}/electron/connect.cts`], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
  types: ['node'],
  typeRoots: [`${root}/node_modules/@types`],
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
  // Type-only renderer contracts participate in checking, never runtime output.
  if (file === `${root}/electron/connect.cjs`) ts.sys.writeFile(file, content);
}).emitSkipped) throw Error('Connect transport emission failed');

// The installed native Settings controller launches this policy worker through
// the already staged Electron binary. Keep its runtime closure in one CJS file.
const policySource = path.resolve(root, '../../../../connect/client/typescript/src/settings-policy.cts');
const electronDirectory = `${root}/electron`;
const electronDirectoryMetadata = await lstat(electronDirectory).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
});
if (!electronDirectoryMetadata?.isDirectory() || electronDirectoryMetadata.isSymbolicLink()) {
  throw new Error('Refusing unsafe Connect policy build directory');
}
const policyOutput = `${electronDirectory}/settings-policy.cjs`;
const existing = await lstat(policyOutput).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== 'ENOENT') throw error;
});
if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
  throw new Error('Refusing unsafe Connect policy build output');
}
await rm(policyOutput, { force: true });
const policyProgram = ts.createProgram([policySource], {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  strict: true,
  skipLibCheck: true,
  types: ['node'],
  typeRoots: [`${root}/node_modules/@types`],
  rootDir: path.dirname(policySource),
  outDir: electronDirectory,
  noEmitOnError: true,
});
const policyDiagnostics = ts.getPreEmitDiagnostics(policyProgram);
if (policyDiagnostics.length) {
  throw Error(ts.formatDiagnosticsWithColorAndContext(policyDiagnostics, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: file => file,
    getNewLine: () => '\n',
  }));
}
if (policyProgram.emit().emitSkipped) throw Error('Connect policy worker emission failed');
