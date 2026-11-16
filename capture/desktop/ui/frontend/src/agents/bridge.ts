import type {PairingPreview} from '../../electron/settings/t3';
import type {PreferenceFacts,T3ConnectionResult} from './policy';
declare global {
  interface Window {
    apparentAgents: {
      read():Promise<PreferenceFacts>;
      save(enabled:boolean):Promise<PreferenceFacts>;
      saveT3(enabled:boolean):Promise<PreferenceFacts>;
      previewT3(server:string):Promise<{preview:PairingPreview;error?:never}|{error:string;preview?:never}>;
      connectT3(id:string):Promise<T3ConnectionResult>;
      cancelT3():Promise<void>;
      disconnectT3(origin?:string):Promise<PreferenceFacts>;
      copySkill():Promise<void>;
      subscribe(callback:(facts:PreferenceFacts)=>void):()=>void;
    };
  }
}
