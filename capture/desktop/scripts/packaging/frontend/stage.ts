import {execFileSync} from 'node:child_process';
import {isAbsolute, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {stagePopupAssets} from '../../../ui/frontend/scripts/popup-entries.mjs';

export async function stageUi(root: string, resources: string, signing: string[], layout = {settings: 'settings', popups: 'note-ui'}) {
  if (!isAbsolute(resources)) throw Error('Expected absolute UI resources destination');
  execFileSync('python3', [resolve(root, 'capture/desktop/scripts/packaging/stage-settings.py'),
    resolve(resources, layout.settings), ...signing], {stdio: 'inherit'});
  await stagePopupAssets(resolve(root, 'capture/desktop/ui/frontend'), resolve(resources, layout.popups));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const appimage = args[0] === '--appimage';
  const [resources, ...signing] = appimage ? args.slice(1) : args;
  const layout = appimage ? {settings: 'usr/share/apparent/settings', popups: 'usr/lib/apparent/note-ui'} : undefined;
  await stageUi(fileURLToPath(new URL('../../../../../', import.meta.url)), resources ?? '', signing, layout);
}
