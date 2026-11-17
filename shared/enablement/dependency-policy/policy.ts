import path from 'node:path';
import {builtinModules} from 'node:module';
import ts from 'typescript';
import {Snapshot, owner, root, source} from './snapshot.ts';

const allowed: Record<string, string[]> = {
  Desktop: ['Record', 'Shared'], Agent: ['Record', 'Shared'],
  Record: ['Engine', 'Shared'], Engine: ['Shared'], Shared: [],
  Connect: ['Shared'], Public: ['Shared'], Hermes: ['Shared'],
  Composition: ['Desktop', 'Agent', 'Record', 'Engine', 'Shared', 'Connect', 'Public', 'Hermes'],
};
// Enumerate export targets (including condition alternatives); never run a package.
function targets(value: unknown): string[] {
  if (typeof value === 'string') return value.startsWith('./') && !value.split('/').some(part => ['..', 'node_modules'].includes(part)) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (value && typeof value === 'object') return Object.values(value).flatMap(targets);
  return [];
}
function exported(manifest: any, subpath: string): unknown {
  const ex = manifest.exports;
  if (!ex) return undefined;
  if (typeof ex === 'string' || Array.isArray(ex)) return subpath === '.' ? ex : undefined;
  if (!Object.keys(ex).some(k => k.startsWith('.'))) return subpath === '.' ? ex : undefined;
  if (Object.hasOwn(ex, subpath)) return ex[subpath];
  const patterns = Object.keys(ex).filter(k => k.includes('*')).sort((a, b) => b.length - a.length);
  for (const key of patterns) {
    const [start, end] = key.split('*');
    if (subpath.startsWith(start) && subpath.endsWith(end)) {
      const match = subpath.slice(start.length, subpath.length - end.length || undefined);
      return targets(ex[key]).map(t => t.replaceAll('*', match));
    }
  }
}
function publicFile(snapshot: Snapshot, file: string): boolean {
  for (const {dir, manifest} of snapshot.packages.values()) {
    const ex = manifest.exports;
    if (!ex) continue;
    const entries = typeof ex === 'object' && !Array.isArray(ex) && Object.keys(ex).some(k => k.startsWith('.'))
      ? Object.entries(ex) : [['.', ex]];
    for (const [key, value] of entries) for (const target of targets(value)) {
      const full = path.posix.normalize(dir + '/' + target);
      let subpath = key;
      if (full.includes('*')) {
        const [start, end] = full.split('*');
        if (!file.startsWith(start) || !file.endsWith(end)) continue;
        subpath = key.replace('*', file.slice(start.length, file.length - end.length || undefined));
      } else if (full !== file) continue;
      if (targets(exported(manifest, subpath)).some(t => path.posix.normalize(dir + '/' + t) === file)) return true;
    }
  }
  return false;
}
export function analyze(snapshot: Snapshot): Set<string> {
  const forbidden = new Set<string>();
  for (const [file, text] of snapshot.files) {
    const from = owner(file);
    if (!from || !source.test(file)) continue;
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const d of (ast as any).parseDiagnostics ?? [])
      snapshot.issues.add(`${file}: syntax: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    const options = snapshot.options(file);
    function edge(spec: string) {
      const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      const pkg = snapshot.packages.get(pkgName);
      let resolved = ts.resolveModuleName(spec, root + '/' + file, options, snapshot.host).resolvedModule?.resolvedFileName;
      let target = resolved ? snapshot.canonical(resolved) : undefined;
      let isPublic = target ? publicFile(snapshot, target) : false;
      // Workspace exports are meaningful even before building untracked dist output.
      // Use the package subpath as identity only when no tracked module resolves.
      if (pkg) {
        const ex = exported(pkg.manifest, '.' + spec.slice(pkgName.length));
        if (targets(ex).length) {
          isPublic = !target || isPublic;
          if (!target) target = `${pkg.dir}/package.json#${spec.slice(pkgName.length) || '.'}`;
        } else if (!target) target = `${pkg.dir}/package.json#private:${spec}`;
      }
      if (target) {
        const to = owner(target);
        if (to !== from && (!to || !allowed[from].includes(to) || !isPublic))
          forbidden.add(`${file} -> ${target} (${from} to ${to}${isPublic ? '' : ', non-public contract'})`);
        return;
      }
      // Builtins and declared external packages are outside repository edge policy.
      const declared = snapshot.manifest(file);
      if (spec.startsWith('node:') || builtinModules.includes(spec) || ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(k => declared[k]?.[pkgName])) return;
      // Non-code resource imports are explicitly outside this checker's coverage.
      if (/\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?|mp[34]|wav|json)(?:\?.*)?$/.test(spec)) return;
      snapshot.issues.add(`${file}: cannot resolve ${JSON.stringify(spec)}; declare external dependency or use staged relative/tsconfig path/workspace exports`);
    }
    function literal(node: ts.Node | undefined, kind: string) {
      if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) edge(node.text);
      else snapshot.issues.add(`${file}: unsupported non-literal ${kind}: ${node?.getText(ast) ?? '<missing>'}; use a literal module specifier`);
    }
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) literal(node.moduleSpecifier, 'import/export');
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        literal(node.moduleReference.expression, 'import equals');
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        literal(node.argument.literal, 'import type');
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        ts.isIdentifier(node.expression) && node.expression.text === 'require' ||
        ts.isPropertyAccessExpression(node.expression) && node.expression.getText(ast) === 'require.resolve')) {
        literal(node.arguments[0], 'import/require');
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  for (const issue of snapshot.issues) forbidden.add(`unsupported: ${issue}`);
  return forbidden;
}
