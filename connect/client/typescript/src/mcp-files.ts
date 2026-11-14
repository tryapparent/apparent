import {constants, createReadStream} from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export function requireValue(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
export async function trustedDirectory(directory: string, privateLeaf = false): Promise<void> {
  requireValue(['linux','darwin'].includes(process.platform),'unsupported_platform');
  requireValue(path.isAbsolute(directory) && path.resolve(directory) === directory,'absolute_path_required');
  const uid = process.getuid!();
  let current = directory;
  for (;;) {
    const stat = await fs.lstat(current);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && [0,uid].includes(stat.uid),'unsafe_directory');
    requireValue(!(stat.mode & 0o022) || !!(stat.mode & 0o1000),'unsafe_directory');
    if (privateLeaf && current === directory) requireValue(stat.uid === uid && !(stat.mode & 0o077),'private_directory_required');
    if (process.platform === 'darwin') {
      const acl = execFileSync('/bin/ls',['-lde',current],{encoding:'utf8',maxBuffer:65536,env:{...process.env,LC_ALL:'C'}});
      // The first line is file metadata, including the path. Only ACL entries
      // determine access; a directory named "allow" does not grant a permission.
      requireValue(!/\ballow\b/.test(acl.split('\n').slice(1).join('\n')),'unsafe_directory_acl');
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
export async function readPrivate(file: string, max = 131072): Promise<Buffer> {
  await trustedDirectory(path.dirname(file),true);
  const handle = await fs.open(file,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireValue(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid!() && !(stat.mode & 0o077) && stat.size <= max,'unsafe_private_file');
    const buffer = Buffer.alloc(max+1);
    let offset=0;
    while (offset<buffer.length) {
      const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);
      if (!bytesRead) break;
      offset+=bytesRead;
    }
    requireValue(offset<=max,'file_too_large');
    return buffer.subarray(0,offset);
  } finally { await handle.close(); }
}
export async function writePrivate(file: string, value: unknown): Promise<void> {
  const temporary = path.join(path.dirname(file),'.write-'+randomBytes(16).toString('hex'));
  try {
    const handle = await fs.open(temporary,'wx',0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary,file);
    const parent = await fs.open(path.dirname(file),'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await fs.rm(temporary,{force:true}); }
}
export async function fileHash(file: string): Promise<string> {
  const digest = createHash('sha256');
  const handle=await fs.open(file,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {for await (const bytes of handle.createReadStream()) digest.update(bytes);}finally{await handle.close();}
  return digest.digest('hex');
}
