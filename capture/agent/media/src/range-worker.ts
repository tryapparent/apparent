import {FrameRangeError,frameRangePlan} from './range-policy.ts';

try {
  const [from,to,fps,...extra]=process.argv.slice(2);
  const time=/^(0|[1-9][0-9]{0,19})$/;
  if(extra.length || !time.test(from ?? '') || !time.test(to ?? '') ||
    fps !== '-' && !/^(0|[1-9][0-9]{0,9})$/.test(fps ?? '')) throw Error('Invalid request');
  const plan=frameRangePlan(BigInt(from),BigInt(to),fps==='-'?undefined:Number(fps));
  process.stdout.write(JSON.stringify({version:1,status:'plan',...plan,
    fromMs:String(plan.fromMs),toMs:String(plan.toMs),stepMs:String(plan.stepMs),
    lowerMs:String(plan.lowerMs),upperMs:String(plan.upperMs)})+'\n');
} catch(error) {
  if(error instanceof FrameRangeError) {
    process.stdout.write(JSON.stringify({version:1,status:'error',message:error.message})+'\n');
  } else {
    process.stderr.write('Agent could not plan the requested frame range\n');process.exitCode=1;
  }
}
