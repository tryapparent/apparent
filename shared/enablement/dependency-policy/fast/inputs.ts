import path from "node:path";
import ts from "typescript";
import type { Snapshot } from "../snapshot.ts";

const matchFiles = (
  ts as typeof ts & {
    matchFiles(
      directory: string,
      extensions: readonly string[] | undefined,
      excludes: readonly string[] | undefined,
      includes: readonly string[] | undefined,
      useCaseSensitiveFileNames: boolean,
      cwd: string,
      depth: number | undefined,
      entries: (dir: string) => { files: string[]; directories: string[] },
      realpath: (file: string) => string,
    ): string[];
  }
).matchFiles;

const indexes = new WeakMap<
  Snapshot,
  Map<string, { files: string[]; directories: string[] }>
>();

function directoryIndex(snapshot: Snapshot) {
  const existing = indexes.get(snapshot);
  if (existing) return existing;
  const index = new Map<string, { files: string[]; directories: string[] }>();
  function directory(dir: string) {
    const existing = index.get(dir);
    if (existing) return existing;
    const entry = { files: [], directories: [] };
    index.set(dir, entry);
    if (dir !== ".")
      directory(path.posix.dirname(dir)).directories.push(
        path.posix.basename(dir),
      );
    return entry;
  }
  for (const file of snapshot.files.keys())
    directory(path.posix.dirname(file)).files.push(path.posix.basename(file));
  indexes.set(snapshot, index);
  return index;
}

export function compilerInputs(
  snapshot: Snapshot,
  root: string,
  config: string,
  installed: { dir: string; packages: Map<string, string> }[],
): Set<string> {
  const inputs = new Set([config]);
  const dirs = directoryIndex(snapshot);
  const aliases = new Map<string, string>();
  for (const { dir, packages } of installed)
    for (const [pkg, target] of packages)
      aliases.set(path.posix.join(root, dir, "node_modules", pkg), target);
  const canonical = (file: string) => {
    file = path.posix.normalize(file);
    for (const [prefix, target] of aliases)
      if (file === prefix || file.startsWith(prefix + "/"))
        return target + file.slice(prefix.length);
    return path.posix.relative(root, file) || ".";
  };
  const directoryExists = (file: string) =>
    dirs.has(canonical(file)) ||
    [...aliases.keys()].some((alias) => alias.startsWith(file + "/"));
  const readFile = (file: string) => {
    const relative = canonical(file);
    const text = snapshot.files.get(relative);
    if (text !== undefined) inputs.add(relative);
    return text;
  };
  const readDirectory: ts.ParseConfigHost["readDirectory"] = (
    dir,
    extensions,
    excludes,
    includes,
    depth,
  ) =>
    matchFiles(
      dir,
      extensions,
      excludes,
      includes,
      true,
      root,
      depth,
      (dir) => dirs.get(canonical(dir)) ?? { files: [], directories: [] },
      (file) => file,
    );
  const host = {
    fileExists: (file: string) => snapshot.files.has(canonical(file)),
    readFile,
    directoryExists,
    realpath: (file: string) => path.posix.join(root, canonical(file)),
    getCurrentDirectory: () => root,
    useCaseSensitiveFileNames: true,
    readDirectory,
    onUnRecoverableConfigFileDiagnostic: () => {},
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.posix.join(root, config),
    {},
    host,
  );
  if (!parsed) return inputs;
  for (const reference of parsed.projectReferences ?? [])
    inputs.add(canonical(ts.resolveProjectReferencePath(reference)));
  const options = { ...parsed.options, noLib: true, types: [] };
  const compiler = ts.createCompilerHost(options);
  ts.createProgram({
    rootNames: parsed.fileNames,
    options,
    host: {
      ...compiler,
      ...host,
      useCaseSensitiveFileNames: () => true,
      getDirectories: (dir) => dirs.get(canonical(dir))?.directories ?? [],
      getSourceFile: (file, languageVersion) => {
        const source = readFile(file);
        return source === undefined
          ? undefined
          : ts.createSourceFile(file, source, languageVersion);
      },
    },
  });
  return inputs;
}
