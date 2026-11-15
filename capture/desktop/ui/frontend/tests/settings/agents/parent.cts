// A synthetic native owner for tests driven through Playwright's Node inspector.
// Playwright closes the OS stdin pipe; retain a separate, explicitly driven pipe.
const {PassThrough}=require('node:stream');
Object.defineProperty(process,'stdin',{value:new PassThrough()});
require('../../../electron/main.cjs');
