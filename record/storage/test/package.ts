/** Real packaged retention planning over copied, producer-generated bundles. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,cpSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const args=process.argv.slice(2);
assert.equal(args.length,4);assert.equal(args[0],'--binary');assert.equal(args[2],'--source-bundle');
const binary=resolve(args[1]),source=resolve(args[3]);
const root=mkdtempSync(join(tmpdir(),'apparent-dev-retention-package-')),home=join(root,'home');
mkdirSync(home,{mode:0o700});
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
function snapshot(path:string):Record<string,unknown> {
  const result:Record<string,unknown>={};
  for(const name of readdirSync(path).sort()) {
    const file=join(path,name),stat=lstatSync(file);assert(!stat.isSymbolicLink());
    result[name]=stat.isDirectory()?snapshot(file):{sha256:hash(file),mode:stat.mode&0o777,size:stat.size};
  }
  return result;
}
const cases:Array<{name:string;days:number;policy?:unknown;pin?:boolean;expected:'none'|'media'|'bundle'}>=[
  {name:'recent',days:0.1,expected:'none'},
  {name:'default-media',days:7.1,expected:'media'},
  {name:'default-bundle',days:30.1,expected:'bundle'},
  {name:'forever',days:100,policy:{mediaDays:null,bundleDays:null},expected:'none'},
  {name:'zero-settling',days:0.5,policy:{mediaDays:0,bundleDays:null},expected:'none'},
  {name:'zero-minimum',days:1.1,policy:{mediaDays:0,bundleDays:null},expected:'media'},
  {name:'bundle-priority',days:1.1,policy:{mediaDays:0,bundleDays:0},expected:'bundle'},
  {name:'pinned',days:100,pin:true,expected:'none'},
  {name:'partial-default',days:7.1,policy:{bundleDays:null},expected:'media'},
  {name:'invalid-leaf-default',days:30.1,policy:{mediaDays:'invalid',bundleDays:null},expected:'bundle'},
  {name:'unknown-extension',days:7.1,policy:{mediaDays:7,bundleDays:null,extension:'synthetic'},expected:'media'},
  {name:'full-u32',days:100,policy:{mediaDays:0xffff_ffff,bundleDays:0xffff_ffff},expected:'none'},
];
const original=snapshot(source);
try {
  for(const value of cases) {
    const directory=join(root,value.name);mkdirSync(directory,{mode:0o700});
    const captures=join(directory,'captures');mkdirSync(captures,{mode:0o700});
    const created=Date.now(),bundle=join(captures,`apparent-${created}-synthetic.apparent`);
    cpSync(source,bundle,{recursive:true,errorOnExist:true,force:false});chmodSync(bundle,0o700);
    const manifest=JSON.parse(readFileSync(join(bundle,'apparent.json'),'utf8'));
    // Age only this copied producer bundle; these are planner facts, not a new
    // capture or a claim about the source recording's provenance.
    manifest.createdAtMs=created;manifest.source='screen';
    writeFileSync(join(bundle,'apparent.json'),JSON.stringify(manifest),{mode:0o600});
    if(value.pin)writeFileSync(join(bundle,'.pinned'),'synthetic preservation fixture\n',{mode:0o600});
    const config=join(directory,'config.json');writeFileSync(config,JSON.stringify({retention:value.policy,
      unrelated:{synthetic:'preserve'}}),{mode:0o600});
    const before=snapshot(captures),beforeConfig=hash(config);
    const output=execFileSync(binary,['clean','--dry-run','--captures',captures,'--days-ahead',String(value.days)],{
      encoding:'utf8',timeout:15_000,env:{...process.env,HOME:home,CFFIXED_USER_HOME:home,APPARENT_CONFIG:config,
        XDG_CONFIG_HOME:join(home,'config'),XDG_DATA_HOME:join(home,'data'),XDG_CACHE_HOME:join(home,'cache'),
        XDG_RUNTIME_DIR:home,DISPLAY:'',WAYLAND_DISPLAY:'',DBUS_SESSION_BUS_ADDRESS:'',APPIMAGE_EXTRACT_AND_RUN:'1'}});
    const lines=output.trim().split('\n').filter(Boolean);
    assert.deepEqual(lines,value.expected==='none'?[]:[`trash ${value.expected==='media'?'media  ':'bundle '}${bundle}`],value.name);
    assert.deepEqual(snapshot(captures),before,'dry-run changed a producer bundle');assert.equal(hash(config),beforeConfig);
  }
  assert.deepEqual(snapshot(source),original,'qualification changed its original producer');
  console.log('Packaged Record Storage retention planner: 12 real CLI cases, native exclusions and unchanged source/config verified; no cleanup executed.');
} finally {rmSync(root,{recursive:true,force:true});}
