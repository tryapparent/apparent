// Connect owns its automatic and manual verification plan.
import {affectedBendOwners} from '../../../shared/enablement/bend/owners.ts';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {suitePlan, planFromOwners, routingProblems} from '../../../enablement/ci/routing/consumers.ts';
import {selectRange} from '../../../enablement/ci/select.ts';

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
  const event = process.env.GITHUB_EVENT_NAME;
  const plan = connectPlan(event === 'workflow_dispatch' ? suitePlan(null) : !range.requiredStreams.connect ? planFromOwners([]) :
    event === 'pull_request' ? range.plan : suitePlan(null));
  const bend = affectedBendOwners(process.cwd(),
    event === 'workflow_dispatch' || !range.historyKnown ? null : range.paths).includes('connect');
  appendFileSync(process.env.GITHUB_OUTPUT!, `publish=${range.publicationStreams.connect}\nplan=${JSON.stringify(plan)}\nnative=${plan.root || plan.client}\nportable=${bend || plan.browser || plan.service || plan.foreground}\nbend=${bend}\n`);
}
