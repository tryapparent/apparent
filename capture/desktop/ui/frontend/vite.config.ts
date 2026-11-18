import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';

// file: dependencies are snapshots. Refuse a build using stale shared controls.
for (const file of ['button.tsx', 'keyboard/keycap.tsx', 'keyboard/keycap.css', 'tabs.tsx', 'utils.ts', 'theme.css', 'tokens.css', 'window-theme.cjs', 'status-card.tsx', 'disclosure-menu.tsx', 'status.css', 'forms/switch.tsx', 'forms/switch.css', 'forms/tooltip.tsx', 'forms/native-select.tsx', 'settings/theme.css']) {
  const canonical = readFileSync(new URL(`../../../../shared/ui/src/${file}`, import.meta.url), 'utf8');
  const installed = readFileSync(new URL(`./node_modules/@apparent/ui/src/${file}`, import.meta.url), 'utf8');
  if (canonical !== installed) throw new Error('Shared UI changed. Run npm ci before building.');
}

let reportingOutput: string;
export default defineConfig({
  base: './',
  resolve: { dedupe: ['react', 'react-dom', '@apparent/ui', 'lucide-react'] },
  plugins: [react(), {
    name: 'settings-utility-sources',
    enforce: 'pre',
    transform(css, id) {
      if (id !== fileURLToPath(new URL('../../../../composition/settings/renderer/base.css', import.meta.url))) return;
      return css.concat(
        "\n@source '../../../capture/desktop/ui/frontend/node_modules/@apparent/ui/src';",
        "\n@source '.';",
      );
    },
  }, tailwindcss(), {name: 'onboarding-host-policy', closeBundle() {
    mkdirSync('dist/composition/onboarding', { recursive: true });
    cpSync('../../../../composition/onboarding/dist/entry.cjs', 'dist/composition/onboarding/entry.cjs');
    for (const name of ['presentation', 'hyprland', 'selection', 'wispr']) {
      const file = `electron/onboarding/${name}.ts`;
      const result = ts.transpileModule(readFileSync(file, 'utf8'), {fileName: file,
        compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}});
      writeFileSync(`dist/onboarding-${name}.cjs`, result.outputText);
    }
  }}, {
    name: 'desktop-reporting-policy',
    apply: 'build',
    configResolved(config) { reportingOutput = path.resolve(config.root, config.build.outDir, config.build.assetsDir); },
    // Emitted beside other staged assets; never commit authored JavaScript.
    closeBundle() {
      const source = readFileSync(new URL('./electron/reporting/index.ts', import.meta.url), 'utf8');
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: 'index.ts',
      });
      mkdirSync(reportingOutput, { recursive: true });
      writeFileSync(path.join(reportingOutput, 'reporting.cjs'), outputText);
    },
  }, { name: 'hermes-native-bridge', async closeBundle() {
    await build({ entryPoints: { 'hermes-main': 'src/hermes/main.ts', 'hermes-preload': 'src/hermes/preload.ts' },
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], outdir: 'dist', outExtension: { '.js': '.cjs' } });
  } }],
  build: { rollupOptions: { input: { foundation: 'index.html', settings: 'settings.html', onboarding: 'onboarding.html', installer: 'src/installer/index.html', pill: 'pill/index.html', controls: 'src/controls/index.html' } } },
});
