import {createRoot} from 'react-dom/client';
import '../../../../../../onboarding/renderer/base.css';
import {NativeOnboarding} from './onboarding';
createRoot(document.getElementById('root')!).render(<NativeOnboarding/>);
