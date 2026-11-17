import {admission} from './policy.ts';
// One bounded, content-free admission exchange; no config writer or Electron API.
let input = '';
const timer = setTimeout(() => process.exit(1), 1500);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
  if (Buffer.byteLength(input) > 2048) process.exit(1);
  const end = input.indexOf('\n');
  if (end < 0) return;
  try {process.stdout.write(JSON.stringify(admission(JSON.parse(input.slice(0, end)))) + '\n');}
  catch {process.exitCode = 1;}
  clearTimeout(timer); process.stdin.destroy();
});
