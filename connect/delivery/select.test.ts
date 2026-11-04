import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compatible,select} from './select.ts';
test('manual force never consults prior artifacts',async()=>assert.equal(await select(true),''));
test('production environment changes invalidate reuse',()=>{
 assert(compatible({token:'a'},{token:'a'}));
 assert(!compatible({token:'a'},{token:'b'}));
 assert(!compatible({token:'a'},{token:'a',added:true}));
 assert(!compatible({token:'a',removed:true},{token:'a'}));
});
