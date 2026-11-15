// One-time T3 bootstrap exchange. The native caller owns the config transaction.
// No server/provider settings or T3 installation files are changed.
export async function pair(link:string){
 const url=new URL(link);if(url.username||url.password||url.hash||url.pathname!=='/pair')throw Error('Use a T3 pairing link');
 if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('T3 requires HTTPS or a loopback connection');
 const token=url.searchParams.get('token');if(!token||token.length>8192)throw Error('The pairing link has no usable token');
 const response=await fetch(new URL('/oauth/token',url.origin),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:token-exchange',subject_token:token,subject_token_type:'urn:t3:params:oauth:token-type:environment-bootstrap',requested_token_type:'urn:ietf:params:oauth:token-type:access_token',scope:'orchestration:read orchestration:operate',client_label:'Apparent',client_device_type:'bot'})});
 if(!response.ok)throw Error('T3 refused the pairing link. Create a fresh link and try again.');
 const value=await response.json() as Record<string,unknown>;
 if(typeof value.access_token!=='string'||!value.access_token||value.access_token.length>8192||typeof value.expires_in!=='number'||!Number.isFinite(value.expires_in)||value.expires_in<=0||value.token_type!=='Bearer')throw Error('T3 did not return a usable session');
 return {origin:url.origin,token:value.access_token,expiresAt:Date.now()+value.expires_in*1000};
}
