import {Readable,Writable} from 'node:stream';
import {acceptEndpoint,type EndpointResult} from './mcp-endpoint.js';
import {MAX_RELAY_REPLY_BYTES} from './mcp-wire.js';

/** Lossless host-to-reader JSON lines. Ciphertext never goes through argv. */
async function* replies(input:Readable):AsyncGenerator<unknown> {
  let parts:Buffer[]=[],size=0;
  for await(const raw of input) {
    const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
    let start=0;
    while(start<chunk.length) {
      const end=chunk.indexOf(10,start),stop=end<0?chunk.length:end;
      size+=stop-start;if(size>MAX_RELAY_REPLY_BYTES)throw new Error('invalid_reply_file');
      parts.push(chunk.subarray(start,stop));start=stop+1;
      if(end>=0) {
        const bytes=Buffer.concat(parts,size);parts=[];size=0;
        yield JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      }
    }
  }
  if(size)throw new Error('reply_requires_newline');
}

/** The host relays printed tool calls and writes whole results to stdin. */
export async function runEndpoint(directory:string,first:EndpointResult,input:Readable,output:Writable):Promise<void> {
  const reader=replies(input),writer=Writable.toWeb(output).getWriter();
  try {
    let current=first;
    while(true) {
      await writer.write(Buffer.from(JSON.stringify(current)+'\n'));
      if(!('tool' in current))return;
      const reply=await reader.next();if(reply.done)throw new Error('relay_reply_required');
      current=await acceptEndpoint(directory,reply.value);
    }
  } finally {await reader.return(undefined);writer.releaseLock();}
}
