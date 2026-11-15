import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const destination = process.argv[2];
if (!destination) {
  throw new Error('Pass a fresh output HTML path outside the repository.');
}
const [template, motion, font] = await Promise.all([
  readFile(new URL('./prototype.html', import.meta.url), 'utf8'),
  readFile(new URL('./motion.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../../../../shared/assets/fonts/HostGrotesk-Variable.ttf', import.meta.url)),
]);
const html = template
  .replace('{{FONT_DATA}}', 'data:font/ttf;base64,' + font.toString('base64'))
  .replace('{{MOTION_SCRIPT}}', stripTypeScriptTypes(motion));
const output = resolve(destination);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, html, { flag: 'wx', mode: 0o600 });
console.log(output);
