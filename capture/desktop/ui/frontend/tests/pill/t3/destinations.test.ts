import {test} from 'node:test';
import assert from 'node:assert/strict';
import {destinations,visibleDestinations,type Thread} from '../../../src/pill/destinations.ts';
test('server shelves hide settled/archived/subagents; working stays among active and snoozes follow',()=>{
 const t=(id:string,extra:Partial<Thread>={}):Thread=>({id,projectId:'p',title:id,createdAt:'2026-01-01',updatedAt:'2026-01-01',...extra});
 const choices=destinations([t('settled',{settledOverride:'settled'}),t('child',{lineage:{relationshipToParent:'subagent'}}),t('archived',{archivedAt:'2026-01-02'}),t('active'),t('working',{status:'running',activeOrderKey:'a'}),t('snooze',{snoozedUntil:'2030-01-01'}),t('pin-b',{pinnedAt:'2026-01-02',pinOrderKey:'b'}),t('pin-a',{pinnedAt:'2026-01-02',pinOrderKey:'a'})],[{id:'p',title:'Project'}],'p');
 assert.deepEqual(choices.map(t=>t.id),['new','pin-a','pin-b','working','active','snooze']);
 assert.equal(choices[3].kind,'working');assert.equal(choices[5].kind,'snoozed');
 assert.deepEqual(visibleDestinations(choices,1).rows.map(t=>t.id),['new','pin-a','pin-b']);
 assert.deepEqual(visibleDestinations(choices,5).rows.map(t=>t.id),['working','active','snooze']);
});
