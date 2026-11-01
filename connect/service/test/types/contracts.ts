import type {Env, ManifestFile, Scope} from '../../src/types.ts';
import {body,session} from '../../src/common.ts';

declare const env: Env;
declare const request: Request;
async function contracts() {
 const input=await body(request);
 // JSON values must be narrowed before they become trusted domain values.
 // @ts-expect-error untrusted scope is unknown, not a validated grant
 const scope: Scope=input.scope;
 // @ts-expect-error official R2 binding rejects non-stream/non-byte object bodies
 await env.BUCKET.put('key',{unvalidated:true});
 // @ts-expect-error manifest sizes are numeric, not caller-controlled strings
 const file: ManifestFile={path:'summary.md',size:'5',sha256:''};
 const optional=await session(request,env,false);
 // @ts-expect-error anonymous sessions must be checked before accessing account
 optional.account_id;
 const required=await session(request,env);
 const account: string=required.account_id;
 return {scope,file,account};
}
void contracts;
