import {Button} from '@apparent/ui/button';
import {DisclosureMenu} from '@apparent/ui/disclosure-menu';
import '@apparent/ui/status.css';
import {shortcutCapture, type ShortcutCapture} from '../../../electron/onboarding/shortcut-editor';

export function ShortcutSuggestions({platform,onChoose}:{platform:'macos'|'linux';onChoose:(shortcut:ShortcutCapture)=>void}){
  return <div className="native-shortcut-suggestions">
    {platform==='macos'&&<p>Fn switches languages? Try another shortcut.</p>}
    <DisclosureMenu label="Show suggestions" trigger="Show suggestions">{close=><>
      {['r','s'].map(key=>{
        const shortcut=shortcutCapture({key,code:`Key${key.toUpperCase()}`,ctrlKey:true,altKey:true,metaKey:false,shiftKey:false},platform)!;
        const label=platform==='macos'?`Control + Option + ${key.toUpperCase()}`:`Ctrl + Alt + ${key.toUpperCase()}`;
        return <Button key={key} variant="ghost" onClick={()=>{close();onChoose(shortcut)}}>{label}</Button>;
      })}
    </>}</DisclosureMenu>
  </div>;
}
