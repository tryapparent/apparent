import {WisprOnboarding as Onboarding, type WisprContext, type WisprProvider} from '../../../../../../onboarding/host/wispr.ts';
import {macWispr} from '../../../../../../onboarding/host/wispr-native.ts';

export {macWispr, savedWisprExperiment} from '../../../../../../onboarding/host/wispr-native.ts';
export type {WisprContext, WisprResult} from '../../../../../../onboarding/host/wispr.ts';

export class WisprOnboarding extends Onboarding {
  constructor(context:()=>WisprContext|null, enabled:()=>Promise<boolean>, provider:WisprProvider=macWispr, platform=process.platform) {
    super(context, enabled, provider, platform);
  }
}
