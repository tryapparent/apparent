// Explicit development/native-verification preparation. Package installation and
// the TypeScript build never invoke Cargo or a native source compiler.
import {prepare} from './stage.ts';

if(process.argv.slice(2).some(value=>value!=='--offline')) throw Error('Usage: prepare.ts [--offline]');
await prepare(process.argv.includes('--offline'));
