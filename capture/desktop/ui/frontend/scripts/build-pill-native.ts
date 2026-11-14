import {execFileSync} from 'node:child_process';
import {access, mkdir, realpath, rename, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Linux and the independent Connect package need no native compiler or headers.
if (process.platform === 'darwin') {
  if (!['arm64', 'x64'].includes(process.arch)) throw Error('Unsupported Mac runtime architecture');
  const executable = await realpath(process.execPath);
  const headers = path.resolve(path.dirname(executable), '../include/node');
  await access(path.join(headers, 'node_api.h'));
  const source = fileURLToPath(new URL('../../../native/pill-window/nonactivating.m', import.meta.url));
  const output = fileURLToPath(new URL('../electron/pill/native/window.node', import.meta.url));
  const temporary = output + '.' + process.pid + '.tmp';
  const architecture = process.arch === 'x64' ? 'x86_64' : 'arm64';
  await mkdir(path.dirname(output), {recursive: true});
  await rm(output, {force: true});
  try {
    // Stable C Node-API v8 and AppKit only: no V8, Node internals or Rust ABI.
    execFileSync('/usr/bin/xcrun', ['clang', '-bundle', '-undefined', 'dynamic_lookup',
      '-arch', architecture, '-fobjc-arc', '-mmacosx-version-min=15.0', '-DNAPI_VERSION=8', '-I', headers,
      '-framework', 'AppKit', source, '-o', temporary], {stdio: 'inherit'});
    if (execFileSync('/usr/bin/lipo', ['-archs', temporary], {encoding: 'utf8'}).trim() !== architecture)
      throw Error('Recording-controls adapter has the wrong architecture');
    await rename(temporary, output);
  } finally { await rm(temporary, {force: true}); }
}
