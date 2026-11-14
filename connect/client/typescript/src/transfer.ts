/** Native capability protocol for index validation and file selection. */
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {fileTransport,validateIndex,selectedAssets} from './transfer/contract.js';
export function transferPlan(input:{transport:unknown;index:unknown;context:import('./transfer/contract.js').FileContext;selection?:string[]}):unknown {
  const transport=fileTransport(input.transport);
  const index=validateIndex(input.index,input.context,transport);
  return selectedAssets(index,input.selection);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of lines){try{if(Buffer.byteLength(line)>1_000_000)throw Error();console.log(JSON.stringify({files:transferPlan(JSON.parse(line))}));}catch{console.log(JSON.stringify({error:'invalid_file_selection'}));process.exitCode=1;}break;}
}
