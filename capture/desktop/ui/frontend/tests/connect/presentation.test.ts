import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectPresentation,connectActionRole} from '../../src/connect/presentation.ts';
import type {ConnectView} from '../../src/connect/protocol.ts';
import {validAction, generalNamedShortcut} from '../../electron/settings/general.ts';
const off:ConnectView={title:'',status:'',detail:'',note:'',server:null,verificationUri:null,userCode:null,phase:'disconnected',localReady:true,buttons:[],presentation:{tone:'neutral',headline:'Uploads are off.',detail:'Native off state',note:'',artwork:false,compact:true,accountMenu:true,accountInitial:'S',buttons:[{command:'connect',title:'Enable uploads',enabled:true},{command:'request-disconnect',title:'Disconnect',enabled:true}],menuActions:['request-disconnect'],sharedLinksUrl:null}};
test('account menu and local enrollment readiness cannot prove an upload grant',()=>{
  for(const accountMenu of [true,false])for(const localReady of [true,false]){
    const {presentation}=connectPresentation({...off,localReady,presentation:{...off.presentation!,accountMenu}});
    assert.equal(presentation?.headline,'Send captures to your cloud agent.');
    assert.equal(presentation?.detail,'Encryption status unavailable.');
  }
});
test('failed and confirmation copy remains authoritative',()=>{
  const failed={...off,phase:'failed' as const,presentation:{...off.presentation!,tone:'failure' as const,headline:'Approval expired'}};
  assert.equal(connectPresentation(failed).presentation?.headline,'Approval expired');
  assert.equal(connectPresentation(failed).step,null);
});
test('General effects reject other pane settings, extra fields and malformed shortcuts',()=>{
  assert.equal(validAction({action:'set',key:'errorReporting',value:false}),true);
  assert.equal(validAction({action:'set',key:'cloud',value:true}),false);
  assert.equal(validAction({action:'set',key:'playbackLevel',value:101}),false);
  assert.equal(validAction({action:'record-shortcut',kind:'record'}),true);
  assert.equal(validAction({action:'record-shortcut',kind:'record',url:'https://example.com'}),false);
  assert.equal(validAction({action:'shortcut',kind:'record',key:'r',keyCode:82,modifiers:4096,reserved:false}),true);
  assert.equal(validAction({action:'shortcut',kind:'record',key:'r',keyCode:82,modifiers:8192,reserved:false}),false);
});

test('E2EE copy requires an affirmative native mode receipt',()=>{
  for(const encryption of [false,null,undefined]) {
    const p=connectPresentation({...off,encryption}).presentation!;
    assert.ok(!p.detail.includes('End-to-end'));
  }
  assert.equal(connectPresentation({...off,encryption:true}).presentation?.detail,'End-to-end encrypted.');
});
test('resume and connection probes never fabricate browser setup stages',()=>{
  for(const phase of ['enabling','checking'] as const) {
    const result=connectPresentation({...off,phase,presentation:{...off.presentation!,tone:'progress'}});
    assert.equal(result.step,null);
    assert.equal(result.presentation?.detail,'');
  }
});
test('durable disconnect progress cannot become a confirmation',()=>{
  const result=connectPresentation({...off,phase:'cancelling',presentation:{...off.presentation!,tone:'progress',headline:'Disconnecting…',buttons:[{command:'disconnect',title:'Please wait…',enabled:false}]}});
  assert.equal(result.presentation?.headline,'Disconnecting…');
  assert.equal(result.step,null);
});

test('initial and paused composition use original art without inventing encryption or setup',()=>{
  for(const encryption of [true,false,null])for(const paused of [true,false]){
    const buttons=off.presentation!.buttons.filter(b=>paused||b.command!=='request-disconnect');
    const result=connectPresentation({...off,encryption,presentation:{...off.presentation!,buttons}});
    assert.equal(result.presentation?.headline,'Send captures to your cloud agent.');
    assert.equal(result.presentation?.artwork,true);
    assert.equal(result.presentation?.compact,false);
    assert.equal(result.step,paused?null:1);
    assert.equal(result.presentation?.detail.includes('End-to-end'),encryption===true);
  }
});
test('disconnect is a preventive warning and keeps cancellation first',()=>{
  const result=connectPresentation({...off,presentation:{...off.presentation!,tone:'warning',buttons:[{command:'disconnect',title:'Disconnect',enabled:true},{command:'cancel',title:'Keep connected',enabled:true}]}});
  assert.equal(result.presentation?.tone,'warning');
  assert.equal(result.presentation?.buttons[0].command,'cancel');
  assert.equal(result.step,null);
});

test('confirmation recommendation wins over native array order for disconnect and upload disable',()=>{
  for(const command of ['disconnect','disable'] as const)for(const reversed of [false,true]) {
    const buttons=[{command,title:'Destructive alternative',enabled:true},{command:'cancel' as const,title:'Keep safe',enabled:true}];
    if(reversed)buttons.reverse();
    const result=connectPresentation({...off,presentation:{...off.presentation!,tone:'warning',buttons}});
    assert.deepEqual(result.presentation?.buttons.map(b=>b.command),['cancel',command]);
  }
});

test('recommendation emphasis distinguishes recovery, ordinary cancel and safe confirmation',()=>{
  assert.equal(connectActionRole('connect','failure',['connect']),'primary-action');
  assert.equal(connectActionRole('open-browser','progress',['open-browser','cancel']),'primary-action');
  assert.equal(connectActionRole('cancel','progress',['open-browser','cancel']),'secondary-action');
  for(const alternative of ['disable','disconnect']) {
    assert.equal(connectActionRole('cancel','warning',[alternative,'cancel']),'primary-action');
    assert.notEqual(connectActionRole(alternative,'warning',[alternative,'cancel']),'primary-action');
  }
});

test('General preserves native function and named key codes through bounded admission',()=>{
  const event={key:'F12',ctrlKey:false,altKey:false,metaKey:false,shiftKey:false};
  for(const [platform,code] of [['linux',123],['macos',111]] as const){
    const captured=generalNamedShortcut(event,platform);
    assert.equal(captured?.keyCode,code);
    assert.equal(validAction({action:'shortcut',kind:'record',...captured,reserved:false}),true);
    const tab=generalNamedShortcut({...event,key:'Tab',altKey:true},platform);
    assert.equal(tab?.keyCode,platform==='linux'?9:48);
    assert.equal(validAction({action:'shortcut',kind:'paste',...tab,reserved:false}),true);
    assert.equal(generalNamedShortcut({...event,key:'F17'},platform),null);
  }
});
