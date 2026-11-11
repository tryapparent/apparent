const {test}=require('node:test');
const assert=require('node:assert/strict');
const {view,command}=require('../../electron/pill/protocol.cjs');
const state={revision:12,phase:'recording',clock:'00:12',label:'Recording',warning:null,reducedMotion:false,draggable:true,
 actions:[{id:'finish',label:'Finish',enabled:true,selected:false,primary:true}]};
test('pill only dispatches available actions for the displayed revision',()=>{
 assert.deepEqual(command(view(state),12,'finish'),{revision:12,action:'finish'});
 for(const args of [[11,'finish'],[12,'paste'],[12,'__proto__'],[12,'select-window']])assert.throws(()=>command(view(state),...args));
 assert.throws(()=>command(null,12,'finish'));
 assert.throws(()=>command(view({...state,actions:[{...state.actions[0],enabled:false}]}),12,'finish'));
});
test('pill projects state and rejects malformed or unbounded controls',()=>{
 assert.equal(view({...state,bundlePath:'/private',token:'secret'}).bundlePath,undefined);
 for(const change of [{revision:-1},{phase:'unknown'},{clock:'x'.repeat(21)},{warning:{}},{draggable:1},
 {actions:[...state.actions,...state.actions]},{actions:[{...state.actions[0],id:'shell'}]}])assert.throws(()=>view({...state,...change}));
});
const geometry=require('../../electron/pill/geometry.cjs');
test('pill input silhouette lets transparent corners through and clamps to negative-origin displays',()=>{
 const bounds={x:-100,y:30,width:600,height:58};
 assert.equal(geometry.contains({x:-100,y:30},bounds),false);
 assert.equal(geometry.contains({x:200,y:30},bounds),true);
 assert.equal(geometry.contains({x:200,y:90},bounds),false);
 const shape=geometry.shape(600,58);
 assert.equal(shape.length,58);assert.ok(shape[0].x>0);assert.equal(shape[28].x,0);
 assert.deepEqual(geometry.clamp({...bounds,x:-2000,y:2000},{x:-1920,y:0,width:1920,height:1080}),{x:-1920,y:1022});
});

test('waveform telemetry is a bounded chronological PCM projection',()=>{
 const inputWaveform=Array.from({length:24},(_,index)=>index/24);
 assert.deepEqual(view({...state,inputWaveform}).inputWaveform,inputWaveform);
 for(const invalid of [[],[.2],Array(25).fill(0),Array(24).fill(NaN),Array(24).fill(-.1),Array(24).fill(1.1)]){
  assert.throws(()=>view({...state,inputWaveform:invalid}));
 }
});
test('saved count is bounded and notes requires authoritative availability',()=>{
 assert.equal(view(state).noteCount,0);
 for(const noteCount of [-1,1.2,101,NaN,'1'])assert.throws(()=>view({...state,noteCount}));
 const notes={id:'notes',label:'Open notes',enabled:true,selected:false,primary:false};
 assert.deepEqual(command(view({...state,noteCount:12,actions:[notes]}),12,'notes'),{revision:12,action:'notes'});
 assert.throws(()=>command(view(state),12,'notes'));
});
