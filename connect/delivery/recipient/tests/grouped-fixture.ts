/** Synthetic encrypted transport, using the existing interoperable endpoint codec. */
import {createHash, createPrivateKey, createPublicKey, randomBytes} from 'node:crypto';
import {encodeArchive, encryptAge, generateAgeIdentity, signEnvelope, type Signed} from '../../../client/typescript/src/index.ts';
export const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export type EndpointKey={version:number;recipient:string;signing:string};
export async function groupedFixture(origin:string,id:string,reader:EndpointKey,evidence:Record<string,Buffer>) {
  const seed=randomBytes(32);
  const key=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),format:'der',type:'pkcs8'});
  const sender={version:1,recipient:(await generateAgeIdentity()).recipient,
    signing:createPublicKey(key).export({format:'der',type:'spki'}).subarray(-32).toString('hex')};
  // Valid 8kHz mono PCM WAV with a short silent sample, not a renamed text fixture.
  const wav=Buffer.alloc(60);wav.write('RIFF');wav.writeUInt32LE(52,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write('data',36);wav.writeUInt32LE(16,40);
  const plain={...evidence,'audio.wav':wav};
  const transport:Record<string,Buffer>={};
  for(const group of ['evidence','media'] as const) {
    const entries=Object.entries(plain).filter(([path])=>(path==='audio.wav')===(group==='media'));
    const context={origin,accountId:'synthetic-account',captureId:id,senderGrantId:'synthetic-sender',group};
    const files=entries.map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes)}));
    const bytes=Buffer.from(await encryptAge(encodeArchive({version:1,context,files},entries.map(([,bytes])=>bytes)),[reader.recipient]));
    const path='sealed/part-000000.age';
    const signed:Signed={version:1,context,chunks:[{path,size:bytes.length,sha256:digest(bytes)}]};
    transport[`${group}/${path}`]=bytes;
    transport[`${group}/envelope.json`]=Buffer.from(JSON.stringify({signed,signature:await signEnvelope(seed,signed)}));
  }
  return {plain,transport,manifest:{id,status:'ready',format:'apparent-encrypted-v1',delivery:'evidence-first-v1',evidenceReady:true,
    files:Object.entries(transport).map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes)}))},
    peers:{accountId:'synthetic-account',grantId:'synthetic-grant',scope:'read',devices:[
      {grantId:'synthetic-grant',scope:'read',key:reader},{grantId:'synthetic-sender',scope:'upload',key:sender}]}};
}
