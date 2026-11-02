// Sign Electron's nested code with its official signer; never blanket --deep-sign the app.
import { sign } from '@electron/osx-sign';
import path from 'node:path';
const [app, identity] = process.argv.slice(2);
if (process.platform !== 'darwin' || !app || !path.isAbsolute(app) || !identity) {
  throw new Error('Expected an absolute Electron.app path and signing identity on macOS');
}
await sign({ app, identity, platform: 'darwin', type: 'distribution',
  preAutoEntitlements: false, identityValidation: identity !== '-',
  optionsForFile: () => ({ hardenedRuntime: identity !== '-',
    entitlements: ['com.apple.security.cs.allow-jit'] }),
});
