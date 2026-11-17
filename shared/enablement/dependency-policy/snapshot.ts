import {execFileSync} from 'node:child_process';
import path from 'node:path';
import ts from 'typescript';

export const root = '/__apparent_snapshot__';
export const source = /\.(?:[cm]?[jt]sx?)$/;
export function git(args: string[], cwd: string, input?: string): string {
  return execFileSync('git', args, {cwd, input, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024});
}
export function owner(file: string): string | undefined {
  for (const [prefix, name] of [
    ['onboarding/', 'Onboarding'], ['handoff/', 'Handoff'], ['agent/', 'Agent'],
    ['capture/agent/', 'Agent'],
    ['capture/desktop/ui/frontend/src/onboarding/', 'Onboarding'],
    ['capture/desktop/ui/frontend/electron/onboarding/', 'Onboarding'],
    ['capture/desktop/settings/onboarding.rs', 'Onboarding'],
    ['capture/desktop/settings/onboarding_window.rs', 'Onboarding'],
    ['capture/desktop/settings/onboarding/', 'Onboarding'],
    ['capture/desktop/settings/practice.rs', 'Onboarding'],
    ['capture/desktop/ui/frontend/src/pill/destination-picker.tsx', 'Handoff'],
    ['capture/desktop/ui/frontend/src/pill/destination-picker.css', 'Handoff'],
    ['capture/desktop/ui/frontend/src/pill/destinations.ts', 'Handoff'],
    ['capture/desktop/ui/frontend/electron/pill/t3/', 'Handoff'],
    ['capture/desktop/linux/interaction/clipboard.rs', 'Handoff'],
    ['capture/desktop/ui/frontend/src/pill/', 'Record'],
    ['capture/desktop/ui/frontend/src/notes/', 'Record'],
    ['capture/desktop/ui/frontend/src/storage/', 'Record'],
    ['capture/desktop/ui/frontend/src/storage.tsx', 'Record'],
    ['capture/desktop/ui/frontend/src/retention.tsx', 'Record'],
    ['capture/desktop/ui/electron_pill/', 'Record'],
    ['capture/desktop/ui/whiteboard.rs', 'Record'],
    ['capture/desktop/native/pill/', 'Record'],
    ['capture/desktop/workflow/notes/', 'Record'],
    ['capture/desktop/workflow/local_transcription/', 'Record'],
    ['capture/desktop/workflow/storage_preferences.rs', 'Record'],
    ['capture/desktop/settings/storage.rs', 'Record'],
    ['capture/desktop/ui/frontend/src/connect/', 'Connect'],
    ['capture/desktop/settings/connect.rs', 'Connect'],
    ['capture/desktop/settings/connect/', 'Connect'],
    ['capture/desktop/workflow/connect_settings.rs', 'Connect'],
    ['capture/desktop/workflow/connect_settings/', 'Connect'],
    ['capture/desktop/', 'Legacy'],
    ['capture/engine/', 'Engine'], ['engine/', 'Engine'], ['record/', 'Record'],
    ['shared/', 'Shared'], ['connect/', 'Connect'], ['public/', 'Public'],
    ['hermes/', 'Hermes'], ['composition/', 'Composition'], ['capture/', 'Legacy'],
  ]) if (prefix.endsWith('/') ? file.startsWith(prefix) : file === prefix) return name;
}
export class Snapshot {
  files = new Map<string, string>();
  modes = new Map<string, string>();
  issues = new Set<string>();
  packages = new Map<string, {dir: string; manifest: any}>();
  configs = new Map<string, ts.CompilerOptions>();
  constructor(cwd: string, tree?: string) {
    if (!tree) return;
    const entries = git(['ls-tree', '-rz', tree], cwd).split('\0').filter(Boolean).map(entry => {
      const separator = entry.indexOf('\t');
      const meta = entry.slice(0, separator), file = entry.slice(separator + 1);
      const [mode, , hash] = meta.split(' ');
      this.modes.set(file, mode);
      return {file, mode, hash};
    });
    const wanted = entries.filter(({file, mode}) => mode.startsWith('100') &&
      (source.test(file) || file.endsWith('.json')) && !file.split('/').some(p => ['node_modules', 'vendor', 'third_party', 'target', '.git'].includes(p)));
    // Buffer framing matters: blob sizes are bytes, not UTF-16 string lengths.
    const bytes = execFileSync('git', ['cat-file', '--batch'], {cwd,
      input: wanted.map(e => e.hash).join('\n') + '\n', maxBuffer: 128 * 1024 * 1024});
    let offset = 0;
    for (const entry of wanted) {
      const end = bytes.indexOf(10, offset);
      const header = bytes.subarray(offset, end).toString().split(' ');
      if (header[1] !== 'blob') throw new Error(`Cannot read ${entry.file}`);
      const size = Number(header[2]);
      this.files.set(entry.file, bytes.subarray(end + 1, end + 1 + size).toString('utf8'));
      offset = end + size + 2;
    }
    for (const [file, text] of this.files) if (file.endsWith('/package.json') || file === 'package.json') {
      const manifest = this.json(file, text);
      if (manifest?.name) {
        if (this.packages.has(manifest.name)) this.issues.add(`${file}: duplicate workspace package ${manifest.name}`);
        this.packages.set(manifest.name, {dir: path.posix.dirname(file), manifest});
      }
    }
    for (const [file, mode] of this.modes) if (!mode.startsWith('100') && owner(file) &&
      (source.test(file) || file.endsWith('.json') || mode === '160000'))
      this.issues.add(`${file}: unsupported Git mode ${mode}; use regular tracked source/config, not symlinks or submodules`);
  }
  json(file: string, text: string): any {
    const parsed = ts.parseConfigFileTextToJson(file, text);
    if (parsed.error) {
      this.issues.add(`${file}: invalid JSON/config: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, ' ')}`);
      return {};
    }
    return parsed.config;
  }
  canonical = (file: string): string => {
    file = path.posix.normalize(file);
    const prefix = root + '/node_modules/';
    if (file.startsWith(prefix)) {
      const tail = file.slice(prefix.length);
      const name = tail.startsWith('@') ? tail.split('/').slice(0, 2).join('/') : tail.split('/')[0];
      const pkg = this.packages.get(name);
      if (pkg) file = root + '/' + pkg.dir + tail.slice(name.length);
    }
    return file.slice(root.length + 1);
  };
  host = {
    fileExists: (file: string) => this.files.has(this.canonical(file)),
    readFile: (file: string) => this.files.get(this.canonical(file)),
    directoryExists: (dir: string) => {
      const prefix = this.canonical(dir) + '/';
      return [...this.files.keys()].some(file => file.startsWith(prefix));
    },
    realpath: (file: string) => root + '/' + this.canonical(file),
    getCurrentDirectory: () => root,
    useCaseSensitiveFileNames: true,
  };
  options(file: string): ts.CompilerOptions {
    let dir = path.posix.dirname(file);
    while (true) {
      const config = dir === '.' ? 'tsconfig.json' : dir + '/tsconfig.json';
      if (this.files.has(config)) {
        if (!this.configs.has(config)) {
          const parsed = ts.getParsedCommandLineOfConfigFile(root + '/' + config, {}, {
            ...this.host, readDirectory: () => [],
            onUnRecoverableConfigFileDiagnostic: d => this.issues.add(`${config}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`),
          });
          // No-input diagnostics are irrelevant: we analyze every tracked source.
          for (const d of parsed?.errors ?? []) if (d.code !== 18003)
            this.issues.add(`${config}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
          this.configs.set(config, parsed?.options ?? {});
        }
        return {...this.configs.get(config), allowJs: true};
      }
      if (dir === '.') break;
      dir = path.posix.dirname(dir);
    }
    return {moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, allowJs: true};
  }
  manifest(file: string): any {
    let dir = path.posix.dirname(file);
    while (true) {
      const text = this.files.get(dir === '.' ? 'package.json' : dir + '/package.json');
      if (text) return this.json(dir + '/package.json', text);
      if (dir === '.') return {};
      dir = path.posix.dirname(dir);
    }
  }
}
