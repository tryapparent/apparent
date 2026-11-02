// Installed entrypoint contains Settings only; development fixtures are not packaged.
if (!process.argv.includes('--settings-agents')) process.argv.push('--settings-storage');
require('./main.cjs');
