import {URL,URLSearchParams} from 'node:url';
// One-time bootstrap exchange shared by Settings and the optional CLI.
// The native caller owns the sole config transaction. Never log link/token data.
export function parsePairingLink(link:string) {
 if(typeof link!=='string'||link.length>16384)throw Error('Copy a full T3 pairing link.');
 let url:URL;try{url=new URL(link.trim());}catch{throw Error('Copy a full T3 pairing link.');}
 if(url.username||url.password||url.hash||url.pathname!=='/pair')throw Error('Copy a full T3 pairing link.');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('T3 requires HTTPS or a loopback connection.');
 const token=url.searchParams.get('token');if(!token||token.length>8192)throw Error('Copy the full pairing link, rather than the code alone.');
 return {origin:url.origin,token};
}
export async function pair(link:string,signal?:AbortSignal){
 const {origin,token}=parsePairingLink(link);
 const response=await fetch(new URL('/oauth/token',origin),{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:token,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:'orchestration:read orchestration:operate',client_label:'Apparent',client_device_type:'bot'})});
 if(!response.ok)throw Error('T3 refused the pairing link. Create a fresh link and try again.');
 const reader=response.body?.getReader();if(!reader)throw Error('T3 did not return a usable session.');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768)throw Error('T3 did not return a usable session.');chunks.push(value);}}
 finally{await reader.cancel();}
 let value:Record<string,unknown>;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('T3 did not return a usable session.');}
 if(!value||typeof value.access_token!=='string'||!value.access_token||value.access_token.length>8192||typeof value.expires_in!=='number'||!Number.isFinite(value.expires_in)||value.expires_in<=0||value.token_type!=='Bearer')throw Error('T3 did not return a usable session.');
 const expiresAt=Date.now()+value.expires_in*1000;if(!Number.isSafeInteger(expiresAt)||expiresAt>8640000000000000)throw Error('T3 did not return a usable session.');
 return {origin,token:value.access_token,expiresAt};
}
