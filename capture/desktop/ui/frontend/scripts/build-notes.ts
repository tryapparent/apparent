import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { rename } from 'node:fs/promises';
const source = fileURLToPath(new URL('../src/notes/presentation.ts', import.meta.url));
const output = fileURLToPath(new URL('../electron/notes', import.meta.url));
const program = ts.createProgram([source], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  strict: true, skipLibCheck: true, types: [], outDir: output, noEmitOnError: true });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: f => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n',
}));
if (program.emit().emitSkipped) throw Error('Notes policy build failed');
await rename(`${output}/presentation.js`, `${output}/presentation.cjs`);
