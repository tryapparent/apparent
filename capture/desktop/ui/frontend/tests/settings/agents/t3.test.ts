import {test} from 'node:test';
import assert from 'node:assert/strict';
import {provider} from './testing/provider.ts';
import {PairingLinks} from '../../../electron/settings/t3.ts';
import {parsePairingLink} from '../../../../../workflow/t3/pair.ts';

test('preview exposes only the origin and binds confirmation to the exact copied link',async context=>{
 const p=await provider(context),links=new PairingLinks(),preview=links.preview(p.link);
 assert.deepEqual(Object.keys(preview).sort(),['id','origin']);assert.equal(preview.origin,p.origin);assert(!JSON.stringify(preview).includes('one-time'));assert.equal(p.exchanged,0);
 const value=await links.connect(preview.id,new AbortController().signal);
 assert.equal(value.token,'private-fixture-token');assert.equal(value.origin,p.origin);assert.equal(p.exchanged,1);
 await assert.rejects(links.connect(preview.id,new AbortController().signal),/fresh/);
});
test('cancel, replacement, mismatched confirmation and cancellation never exchange a credential',async context=>{
 const p=await provider(context),links=new PairingLinks();
 let preview=links.preview(p.link);links.clear();await assert.rejects(links.connect(preview.id,new AbortController().signal),/fresh/);
 preview=links.preview(p.link);links.preview(p.link);await assert.rejects(links.connect(preview.id,new AbortController().signal),/fresh/);
 preview=links.preview(p.link);const abort=new AbortController();abort.abort();await assert.rejects(links.connect(preview.id,abort.signal));assert.equal(p.exchanged,0);
});
test('a refused link never becomes a saved session',async context=>{
 const p=await provider(context),links=new PairingLinks();p.refuse();const preview=links.preview(p.link);
 await assert.rejects(links.connect(preview.id,new AbortController().signal),/fresh link/);assert.equal(p.exchanged,1);
});
test('pairing inputs reject private userinfo, remote HTTP, missing token and non-pair URLs without echoing secrets',()=>{
 for(const value of ['http://example.com/pair?token=SECRET','https://a:SECRET@example.com/pair?token=x','https://example.com/?token=SECRET','SECRET','https://example.com/pair']){
  assert.throws(()=>parsePairingLink(value),error=>error instanceof Error&&!error.message.includes('SECRET'));
 }
});

test('a preview expires without a network exchange',async context=>{
 const p=await provider(context),links=new PairingLinks();
 context.mock.timers.enable({apis:['setTimeout','Date']});const preview=links.preview(p.link);
 context.mock.timers.tick(120001);await assert.rejects(links.connect(preview.id,new AbortController().signal),/fresh/);assert.equal(p.exchanged,0);
});
