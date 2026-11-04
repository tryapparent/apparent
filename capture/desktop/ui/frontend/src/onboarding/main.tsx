import '../runtime/exceptions';
import '../style.css';
import {createRoot} from 'react-dom/client';
import {NativeOnboarding} from './onboarding';
import {BuildIdentity} from '@apparent/ui/build-identity';
createRoot(document.getElementById('root')!).render(<><NativeOnboarding/><BuildIdentity/></>);
