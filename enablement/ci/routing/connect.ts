// Connect's direct workflow retains native consumer checks without requiring the
// repository delivery workflow to run for a Connect-only change.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {suitePlan} from './consumers.ts';
import {selectRange} from '../select.ts';

export function connectPlan(consumers: ReturnType<typeof suitePlan>) {
  // Existing service/client contracts are consumed by the root application on
  // both platforms. Unknown inputs retain those same conservative consumers.
  return {root: consumers.root && (consumers.client || consumers.service), engine: false, desktop: false,
    client: consumers.client, browser: consumers.browser, service: consumers.service,
    tools: false, hermes: false};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const range = selectRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? 'HEAD');
  const plan = connectPlan(range.plan);
  appendFileSync(process.env.GITHUB_OUTPUT!, `plan=${JSON.stringify(plan)}\nnative=${plan.root || plan.client}\nportable=${plan.browser || plan.service}\n`);
}
