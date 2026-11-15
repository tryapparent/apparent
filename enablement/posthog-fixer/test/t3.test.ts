import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {T3, projection} from '../t3.ts';

// Minimal RFC6455 peer verifies the actual ticket/Effect framing, without an SDK mock.
test('T3 exchanges a bearer for a ticket, correlates Effect replies and rejects failures', async t => {
  const directory=mkdtempSync(join(tmpdir(),'apparent-dev-posthog-rpc-')); const token=join(directory,'token');
  writeFileSync(token,'x'.repeat(40),{mode:0o600});t.after(()=>rmSync(directory,{recursive:true,force:true}));
  let tickets=0;const requests:any[]=[];
  const app=createServer((req,res)=>{
    assert.equal(req.method,'POST');assert.equal(req.url,'/api/auth/websocket-ticket');
    assert.equal(req.headers.authorization,`Bearer ${'x'.repeat(40)}`);tickets++;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ticket:'synthetic-ticket'}));
  });
  app.on('upgrade',(req,socket)=>{
    assert.equal(req.url,'/ws?orchestrationProtocol=2&wsTicket=synthetic-ticket');
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const send=(data:object)=>{const bytes=Buffer.from(JSON.stringify(data));const header=bytes.length<126?Buffer.from([0x81,bytes.length]):Buffer.from([0x81,126,bytes.length>>8,bytes.length&255]);socket.write(Buffer.concat([header,bytes]));};
    let buffer=Buffer.alloc(0);
    socket.on('error',()=>{});
    socket.on('data',chunk=>{
      buffer=Buffer.concat([buffer,chunk]);if(buffer.length<6)return;
      if((buffer[0]&15)===8){socket.end(Buffer.from([0x88,0]));return;}
      let length=buffer[1]&127;let offset=2;
      if(length===126){if(buffer.length<8)return;length=buffer.readUInt16BE(2);offset=4;}
      if(buffer.length<offset+4+length)return;
      const mask=buffer.subarray(offset,offset+4);const data=Buffer.from(buffer.subarray(offset+4,offset+4+length));
      for(let i=0;i<data.length;i++)data[i]^=mask[i%4];buffer=buffer.subarray(offset+4+length);
      const request=JSON.parse(data.toString());requests.push(request);
      send({_tag:'Exit',requestId:'unrelated',exit:{_tag:'Success',value:'wrong'}});
      send({_tag:'Exit',requestId:request.id,exit: request.tag==='rejected'?{_tag:'Failure',cause:{private:'must not escape'}}:{_tag:'Success',value:{accepted:true}}});
    });
  });
  app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>app.close());
  const rpc=new T3(`http://127.0.0.1:${(app.address() as {port:number}).port}`,token,1000);
  assert.deepEqual(await rpc.call('orchestration.launchThread',{commandId:'stable-command'}),{accepted:true});
  await assert.rejects(rpc.call('rejected',{}),{message:'T3 RPC rejected'});
  assert.equal(tickets,2);assert.equal(requests[0]._tag,'Request');assert.deepEqual(requests[0].headers,[]);
  assert.equal(requests[0].payload.commandId,'stable-command');
  assert.throws(()=>projection({thread:{id:'wrong'}},'expected','project'));
});
