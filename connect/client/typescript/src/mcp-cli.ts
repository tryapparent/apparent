#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import {constants,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {initEndpoint,nextEndpoint,acceptEndpoint,fetchEndpoint,revokeEndpoint,cancelEndpoint} from './mcp-endpoint.js';
import {runEndpoint} from './mcp-stdio.js';
import {MAX_RELAY_REPLY_BYTES} from './mcp-wire.js';

export async function main(args:string[]):Promise<void> {
  if(args.includes('--help') || !args.length) {
    console.log('apparent-connect-mcp init --state <new-private-directory> [--server <https-origin>]\napparent-connect-mcp step --state <directory> --reply <MCP-result.json>\napparent-connect-mcp next --state <directory>\napparent-connect-mcp inspect --state <directory> --id <capture-id> --out <new-absolute-inspection-path>\napparent-connect-mcp fetch --state <directory> --id <capture-id> --out <new-absolute-bundle-path>\napparent-connect-mcp run --state <directory> [--id <capture-id> --out <new-absolute-path> --mode inspection|bundle]\napparent-connect-mcp cancel --state <directory>\napparent-connect-mcp revoke --state <directory>\nThis endpoint runs offline. Prefer inspect for images. run prints opaque tool calls as JSON lines and consumes complete MCP replies from stdin; a host tool loop can transfer without sending ciphertext through model context. step remains available for hosts that save whole replies to files. Private keys and credentials stay in the private state directory.');return;
  }
  const [command,...rest]=args,options=new Map<string,string>();
  for(let i=0;i<rest.length;i+=2) {
    if(!/^--(?:state|server|reply|id|out|mode)$/.test(rest[i]??'') || !rest[i+1] || options.has(rest[i]!))throw new Error('invalid_arguments');
    options.set(rest[i]!,rest[i+1]!);
  }
  const state=options.get('--state');if(!state)throw new Error('state_required');
  let result;
  if(command==='init')result=await initEndpoint(state,options.get('--server'));
  else if(command==='next')result=await nextEndpoint(state);
  else if(command==='revoke')result=await revokeEndpoint(state);
  else if(command==='cancel')result=await cancelEndpoint(state);
  else if(command==='run') {
    const mode=options.get('--mode')??'inspection';if(!['inspection','bundle'].includes(mode))throw new Error('invalid_arguments');
    const capture=options.get('--id'),out=options.get('--out');if(!!capture!==!!out)throw new Error('capture_and_output_required');
    const first=capture&&out?await fetchEndpoint(state,capture,out,mode==='inspection'):await nextEndpoint(state);
    await runEndpoint(state,first,process.stdin,process.stdout);return;
  } else if(command==='fetch'||command==='inspect') {
    if(!options.get('--id')||!options.get('--out'))throw new Error('capture_and_output_required');
    result=await fetchEndpoint(state,options.get('--id')!,options.get('--out')!,command==='inspect');
  } else if(command==='step') {
    const reply=options.get('--reply');if(!reply)throw new Error('reply_required');
    const handle=await fs.open(reply,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const stat=await handle.stat();if(!stat.isFile() || stat.size>MAX_RELAY_REPLY_BYTES)throw new Error('invalid_reply_file');
      const bytes=Buffer.alloc(MAX_RELAY_REPLY_BYTES+1);let size=0;
      while(size<bytes.length){const read=await handle.read(bytes,size,bytes.length-size,null);if(!read.bytesRead)break;size+=read.bytesRead;}
      if(size>MAX_RELAY_REPLY_BYTES)throw new Error('invalid_reply_file');
      result=await acceptEndpoint(state,JSON.parse(bytes.subarray(0,size).toString('utf8')));
    } finally {await handle.close();}
  } else throw new Error('unknown_command');
  console.log(JSON.stringify(result));
}
// npm installs a symlink for the executable; Node resolves the module URL but
// preserves that symlink in argv. This also handles Darwin's /tmp alias.
function invokedAsMain(): boolean {
  try { return !!process.argv[1] && realpathSync(process.argv[1])===fileURLToPath(import.meta.url); }
  catch { return false; }
}
if(invokedAsMain())main(process.argv.slice(2)).catch((error:unknown)=>{
  // Never print raw exceptions: a provider or malformed input may contain secrets.
  const code=error instanceof Error && /^[a-z_]{1,100}$/.test(error.message)?error.message:'endpoint_operation_failed';
  console.error(`Connect MCP endpoint failed (${code}). Preserve its private state and check the command, reply, permissions and approval status. No unverified recording is ready.`);
  process.exitCode=1;
});
