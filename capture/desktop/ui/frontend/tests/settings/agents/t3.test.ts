import {test} from 'node:test';
import assert from 'node:assert/strict';
import {provider} from './testing/provider.ts';
import {PairingLinks} from '../../../electron/settings/t3.ts';
import {parsePairingLink} from '../../../../../workflow/t3/pair.ts';

test('preview exposes only the origin and binds confirmation to the exact copied link',async context=>{
 const p=await provider(context),links=new PairingLinks(),preview=links.preview(p.link);
 assert.deepEqual(Object.keys(preview).sort(),['id','origin']);assert.equal(preview.origin,p.origin);assert(!JSON.stringify(preview).includes(p.code));assert.equal(p.exchanged,0);
 const value=await links.connect(preview.id,new AbortController().signal);
 assert.equal(value.token,'private-fixture-token');assert.equal(value.origin,p.origin);assert.equal(p.exchanged,1);
 await assert.rejects(links.connect(preview.id,new AbortController().signal),/fresh/);
});
test('a copied code uses the selected server, remains private and exchanges only after confirmation',async context=>{
 const p=await provider(context),links=new PairingLinks();
 assert.deepEqual(parsePairingLink('  '+p.code+'\n',p.origin),{origin:p.origin,token:p.code});
 const preview=links.preview(p.code,p.origin);
 assert.deepEqual(Object.keys(preview).sort(),['id','origin']);assert.equal(preview.origin,p.origin);
 assert(!JSON.stringify(preview).includes(p.code));assert.equal(p.exchanged,0);
 const value=await links.connect(preview.id,new AbortController().signal);
 assert.equal(value.origin,p.origin);assert.equal(value.token,'private-fixture-token');assert.equal(p.exchanged,1);
 await assert.rejects(links.connect(preview.id,new AbortController().signal),/fresh/);
});
test('a full link supplies its own server even when the code-only address differs',()=>{
 assert.deepEqual(parsePairingLink('https://t3.example/pair?token=23456789ABCD','http://localhost:3773'),{origin:'https://t3.example',token:'23456789ABCD'});
});
test('code-only pairing requires a safe explicit server and never interprets a malformed link as a code',()=>{
 const code='23456789ABCD';
 for(const origin of [undefined,'','file:///tmp/t3','http://remote.example','https://user:SECRET@t3.example','https://t3.example/path','https://t3.example/?token=SECRET']){
  assert.throws(()=>parsePairingLink(code,origin),error=>error instanceof Error&&!error.message.includes('SECRET')&&!error.message.includes(code));
 }
 for(const value of ['https://t3.example/not-pair?token=SECRET','bad code','x'.repeat(8193)])assert.throws(()=>parsePairingLink(value,'http://localhost:3773'));
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
