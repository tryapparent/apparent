// Connect consumes the automatic shared producer or runs independent manual checks.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {suitePlan, routingProblems} from './consumers.ts';
import {selectRange} from '../select.ts';

export function connectPlan(consumers: ReturnType<typeof suitePlan>) {
  // Existing service/client contracts are consumed by the root application on
  // both platforms. Unknown inputs retain those same conservative consumers.
  return {root: consumers.root && (consumers.client || consumers.service), engine: false, desktop: false,
    client: consumers.client, foreground: consumers.foreground, browser: consumers.browser, service: consumers.service,
    tools: false, hermes: false, public: false, tooling: false, onboarding: false, engineMedia: false};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const range = selectRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? 'HEAD');
  if (process.argv.includes('--admit') && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    const problems = routingProblems(range);
    if (problems.length) throw Error(problems.join('\n'));
  }
  const plan = connectPlan(process.env.GITHUB_EVENT_NAME === 'pull_request' ? range.plan : suitePlan(null));
  const {sharedNative, identity} = await import('./native-sharing/run.ts');
  const shared = sharedNative(process.env.SHARED_NATIVE, identity(), plan);
  appendFileSync(process.env.GITHUB_OUTPUT!, `shared=${shared}\npublish=${range.publicationStreams.connect}\nplan=${JSON.stringify(plan)}\nnative=${plan.root || plan.client}\nportable=${plan.browser || plan.service || plan.foreground}\n`);
}
