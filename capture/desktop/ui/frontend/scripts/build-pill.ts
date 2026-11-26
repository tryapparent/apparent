import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import ts from 'typescript';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import './build-pill-native.ts';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const recordBuild = join(root, 'record/enablement/ci/bend/build.ts');
const captionBuild = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), 'apparent-dev-caption-policy-'));
try {
 execFileSync(process.execPath, [recordBuild, captionBuild, 'captions'], {stdio: 'inherit'});
 await build({
  entryPoints: [join(root, 'record/transcription/src/worker.ts')],
  outfile: fileURLToPath(new URL('../electron/notes/record-transcription.cjs', import.meta.url)),
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  plugins: [{
   name: 'record-caption-policy',
   setup(builder) {
    builder.onResolve({filter: /caption-admission\.mjs$/}, () => ({path: join(captionBuild, 'caption-admission.mjs')}));
   },
  }],
 });
} finally {
 await rm(captionBuild, {recursive: true, force: true});
}
execFileSync(process.execPath, [
 fileURLToPath(new URL('../../../../../handoff/enablement/ci/bend/build.ts', import.meta.url)),
], {stdio:'inherit'});
await build({entryPoints:[fileURLToPath(new URL('../../../../../composition/handoff/main/entry.ts',import.meta.url))],
 outfile:fileURLToPath(new URL('../electron/pill/t3.cjs',import.meta.url)),bundle:true,platform:'node',format:'cjs',target:'node22'});
// Record owns the source; the installed app uses its already packaged Node runtime.
// No native compiler, Electron API or renderer is a dependency of this worker.
const completion = new URL('../electron/record-completion/', import.meta.url);
const recordSources = ['completion', 'transcription'].flatMap(owner=>['policy', 'worker'].map(name=>fileURLToPath(new URL(`../../../../../record/${owner}/src/${name}.ts`,import.meta.url))));
const program = ts.createProgram([...recordSources,join(root, "record/transcription/src/openrouter.ts"),fileURLToPath(new URL('../electron/pill/diagnostics.cts',import.meta.url)),fileURLToPath(new URL('../../../../../composition/handoff/main/entry.ts',import.meta.url))],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,
 strict:true,skipLibCheck:true,noEmit:true,allowImportingTsExtensions:true,types:['node'],typeRoots:[fileURLToPath(new URL('../node_modules/@types',import.meta.url))]});
const diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
await mkdir(completion, {recursive: true});
execFileSync(process.execPath, ['--experimental-strip-types',
 recordBuild,
 fileURLToPath(completion)], {stdio:'inherit'});
for (const name of ['policy', 'session', 'worker']) {
 const source=await readFile(new URL(`../../../../../record/completion/src/${name}.ts`,import.meta.url),'utf8');
 const output=ts.transpileModule(source,{fileName:`${name}.ts`,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,rewriteRelativeImportExtensions:true}});
 await writeFile(new URL(`${name}.js`,completion),output.outputText);
}
await writeFile(new URL('package.json',completion),JSON.stringify({type:'module'}));
// CommonJS is required by Electron's sandboxed preload; generated files stay out of Git.
for (const name of ['main','preload','protocol','geometry','diagnostics']) {
 const input=new URL(`../electron/pill/${name}.cts`,import.meta.url);
 const source=await readFile(input,'utf8');
 const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
 await writeFile(new URL(`../electron/pill/${name}.cjs`,import.meta.url),output.outputText);
}

for (const name of ['host','framing']) {
 const source=await readFile(new URL(`../tests/pill/${name}.cts`,import.meta.url),'utf8');
 await writeFile(new URL(`../tests/pill/${name}.cjs`,import.meta.url),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText);
}
