import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { rename } from 'node:fs/promises';
import { buildDropdown } from '../../../../../record/notes/build-dropdown.ts';
const names = ['presentation', 'lifecycle'];
const sources = names.map(name => fileURLToPath(new URL(`../src/notes/${name}.ts`, import.meta.url)));
const output = fileURLToPath(new URL('../electron/notes', import.meta.url));
const program = ts.createProgram(sources, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  strict: true, skipLibCheck: true, types: [], outDir: output, noEmitOnError: true });
const { emitSkipped, diagnostics } = program.emit();
if (emitSkipped) throw Error(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'));
for (const name of names) await rename(`${output}/${name}.js`, `${output}/${name}.cjs`);
await buildDropdown(output);
