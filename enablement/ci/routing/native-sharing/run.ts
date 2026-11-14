// Automatic streams share one Actions DAG. Receipts are inputs from its producer
// dependencies, never an artifact/status supplied by a different workflow run.
import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {parsePlan} from '../run.ts';
import {accepted, covers} from '../evidence.ts';
import {connectPlan} from '../connect.ts';
import {suitePlan, planFromOwners} from '../consumers.ts';
import {selectRange} from '../../select.ts';

type Plan = ReturnType<typeof parsePlan>;
export const nativeRequired = (plan: Plan) => plan.root || plan.engine || plan.desktop || plan.client;
export function unionPlan(left: Plan, right: Plan): Plan {
  return Object.fromEntries(Object.keys(left).map(key => [key, left[key as keyof Plan] || right[key as keyof Plan]])) as Plan;
}
export type Identity = {sha: string; tree: string; run: string; attempt: string; workflow: string};
export type NativeReceipt = Identity & {schema: 1; plan: Plan; macPlan: Plan; linux: boolean; macos: boolean};
export function sharedNative(raw: string | undefined, identity: Identity, required: Plan): boolean {
  try {
    const receipt = JSON.parse(raw ?? '') as NativeReceipt;
    const trusted = identity.workflow === 'tryapparent/apparent/.github/workflows/checks.yml@refs/heads/main' ||
      /^tryapparent\/apparent\/\.github\/workflows\/checks.yml@refs\/pull\/\d+\/merge$/.test(identity.workflow);
    return trusted && receipt.schema === 1 && Object.entries(identity).every(([key, value]) => value && receipt[key as keyof Identity] === value) &&
        receipt.linux === true && receipt.macos === true && covers(receipt.plan, required) && covers(receipt.macPlan, required);
  } catch { return false; }
}
const git = (ref: string) => execFileSync('git', ['rev-parse', ref], {encoding: 'utf8'}).trim();
export function identity(): Identity {
  return {sha: git('HEAD'), tree: git('HEAD^{tree}'), run: process.env.GITHUB_RUN_ID!,
    attempt: process.env.GITHUB_RUN_ATTEMPT!, workflow: process.env.GITHUB_WORKFLOW_REF!};
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const output = (values: object) => appendFileSync(process.env.GITHUB_OUTPUT!, Object.entries(values).map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}\n`).join(''));
  if (process.argv.includes('--plan')) {
    const range = selectRange(process.env.BASE_SHA ?? '', process.env.GITHUB_SHA ?? 'HEAD');
    // Event filters are a scheduling superset, not an extra product consumer.
    // Verification-only inputs must not widen a tooling plan into all of Connect.
    const connect = range.requiredStreams.connect;
    const manualOrMain = process.env.GITHUB_EVENT_NAME !== 'pull_request';
    const additional = connect ? connectPlan(manualOrMain ? suitePlan(null) : range.plan) : planFromOwners([]);
    const plan = unionPlan(parsePlan(process.env.VERIFICATION_PLAN), additional);
    const macPlan = unionPlan(parsePlan(process.env.MAC_VERIFICATION_PLAN), additional);
    output({plan, mac_plan: macPlan, connect, platform: nativeRequired(plan), macos: nativeRequired(macPlan),
      mac_rust: macPlan.root || macPlan.engine || additional.client || process.env.MAC_RUST !== 'false'});
  } else if (process.argv.includes('--receipt')) {
    const plan = parsePlan(process.env.VERIFICATION_PLAN), macPlan = parsePlan(process.env.MAC_VERIFICATION_PLAN);
    const needs = JSON.parse(process.env.CI_NEEDS!);
    const reuse = needs.reuse?.result === 'success' ? needs.reuse.outputs : {};
    const required = {linux: nativeRequired(plan), macos: nativeRequired(macPlan)};
    if (!accepted(needs, required, {linux: reuse?.linux === 'true', macos: reuse?.macos === 'true'})) throw Error('Shared native producer did not pass');
    output({receipt: {...identity(), schema: 1, plan, macPlan, linux: true, macos: true}});
  }
}
