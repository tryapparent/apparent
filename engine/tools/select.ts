// Hosted admission consumes the same authority as the local hook.
import {appendFileSync} from 'node:fs';
import {selectRange} from '../../enablement/ci/select.ts';
import {routingProblems} from '../../enablement/ci/routing/consumers.ts';

const decision = selectRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? 'HEAD');
const problems = routingProblems(decision);
if (problems.length && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw Error(problems.join('\n'));
appendFileSync(process.env.GITHUB_OUTPUT!, `selected=${decision.plan.engineMedia}\n`);
