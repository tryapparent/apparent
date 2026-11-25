import type {PairingPreview} from '../../../electron/settings/t3';
import type {PreferenceFacts,T3ConnectionResult} from './policy';
import type {T3Environment} from '../../../../../../../handoff/settings/t3-contract';
declare global {
  interface Window {
    apparentAgents: {
      read():Promise<PreferenceFacts>;
      saveT3(enabled:boolean):Promise<PreferenceFacts>;
      previewT3(server:string):Promise<{preview:PairingPreview;error?:never}|{error:string;preview?:never}>;
      connectT3(id:string):Promise<T3ConnectionResult>;
      cancelT3():Promise<void>;
      disconnectT3(origin?:string):Promise<PreferenceFacts>;
      copySkill():Promise<void>;
      copyT3Setup():Promise<void>;
      t3Environments():Promise<T3Environment[]>;
      subscribe(callback:(facts:PreferenceFacts)=>void):()=>void;
    };
  }
}
