// Prepare once, then stage both installed UI consumers from that fresh build.
import {execFileSync} from 'node:child_process';
import {isAbsolute, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {stagePopupAssets} from '../../../ui/frontend/scripts/popup-entries.mjs';

export async function stageUi(root: string, resources: string, signing: string[]) {
  if (!isAbsolute(resources)) throw Error('Expected absolute UI resources destination');
  // The ordinary Settings packager owns the locked installs, full frontend build,
  // Connect preparation and nested signing. A failure must prevent popup staging.
  execFileSync('python3', [resolve(root, 'capture/desktop/scripts/packaging/stage-settings.py'),
    resolve(resources, 'settings'), ...signing], {stdio: 'inherit'});
  await stagePopupAssets(resolve(root, 'capture/desktop/ui/frontend'), resolve(resources, 'note-ui'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [resources, ...signing] = process.argv.slice(2);
  await stageUi(fileURLToPath(new URL('../../../../../', import.meta.url)), resources ?? '', signing);
}
