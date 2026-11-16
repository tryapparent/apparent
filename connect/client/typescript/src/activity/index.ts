// Product policy: recording starts count only for connected, non-practice
// Desktop captures. Tokens/account identities never cross this private protocol.
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
export function recordingActivity(value:unknown):boolean {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const v=value as Record<string,unknown>;
 return Object.keys(v).sort().join(',')==='connected,practice,recording'
  &&v.connected===true&&v.practice===false&&v.recording===true;
}
async function stdio(){
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
 for await(const line of lines){
  let collect=false;try{if(Buffer.byteLength(line)<=128)collect=recordingActivity(JSON.parse(line));}catch{}
  process.stdout.write(JSON.stringify({operation:collect?'recording-started':'skip'})+'\n');
  lines.close();return;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)void stdio();
