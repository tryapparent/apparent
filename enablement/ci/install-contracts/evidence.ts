// Same-attempt, opportunistic Actions evidence. Never wait for the producer.
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir, release} from 'node:os';
import {join} from 'node:path';

export const installCommand = {argv: ['node', '--experimental-strip-types', '--test', 'capture/desktop/enablement/local-tests/desktop-install.test.ts'], cwd: '.'};
export const fixtureStep = 'Real hook and dependency-install fixtures without native application builds';
export type Identity = {sha: string; tree: string; run: string; attempt: string; workflow: string;
  node: string; npm: string; platform: string; arch: string; image: string; osRelease: string; suite: typeof installCommand};
export const artifactName = (attempt: string) => `mac-install-contracts-${attempt}`;
export function identity(cwd: string): Identity {
  const git = (ref: string) => execFileSync('git', ['rev-parse', ref], {cwd, encoding: 'utf8'}).trim();
  // A modified tracked input cannot consume or publish same-tree proof.
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--'], {cwd, stdio: 'pipe'});
  return {sha: git('HEAD'), tree: git('HEAD^{tree}'), run: process.env.GITHUB_RUN_ID ?? '',
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? '', workflow: process.env.GITHUB_WORKFLOW_REF ?? '',
    node: process.version, npm: execFileSync('npm', ['--version'], {cwd, encoding: 'utf8'}).trim(),
    platform: process.platform, arch: process.arch, image: `${process.env.ImageOS ?? ''}:${process.env.ImageVersion ?? ''}`,
    osRelease: release(), suite: installCommand};
}
export function trusted(value: Identity, env: NodeJS.ProcessEnv): boolean {
  return env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === 'tryapparent/apparent' &&
    ['push', 'pull_request'].includes(env.GITHUB_EVENT_NAME ?? '') && value.platform === 'darwin' && value.arch === 'x64' &&
    /^macos[^:]+:[^:]+$/.test(value.image) && !!value.osRelease && value.sha === env.GITHUB_SHA && /^[a-f0-9]{40}$/.test(value.sha) && /^[a-f0-9]{40}$/.test(value.tree) &&
    /^[1-9][0-9]*$/.test(value.run) && /^[1-9][0-9]*$/.test(value.attempt) &&
    (value.workflow === 'tryapparent/apparent/.github/workflows/checks.yml@refs/heads/main' ||
      /^tryapparent\/apparent\/\.github\/workflows\/checks.yml@refs\/pull\/[0-9]+\/merge$/.test(value.workflow));
}
export function matches(receipt: any, expected: Identity): boolean {
  return receipt?.schema === 1 && Object.entries(expected).every(([key, value]) =>
    JSON.stringify(receipt[key]) === JSON.stringify(value));
}
export function publish(cwd: string): void {
  const value = identity(cwd);
  if (!trusted(value, process.env)) return;
  writeFileSync(join(process.env.RUNNER_TEMP!, 'mac-install-contracts.json'), JSON.stringify({schema: 1, ...value}));
}
type API = (path: string) => Promise<any>;
export async function lookup(expected: Identity, api: API, read: (id: number) => Promise<unknown>): Promise<boolean> {
  try {
    const inventory = await api(`actions/runs/${expected.run}/attempts/${expected.attempt}/jobs?per_page=100`);
    if (!Array.isArray(inventory.jobs) || inventory.total_count !== inventory.jobs.length) return false;
    const jobs = inventory.jobs.filter((job: any) => job.name === 'Mac hook fixtures');
    if (jobs.length !== 1) return false;
    const job = jobs[0];
    if (String(job.run_id) !== expected.run || String(job.run_attempt) !== expected.attempt ||
        job.status !== 'completed' || job.conclusion !== 'success' ||
        !job.labels?.includes('macos-15-intel') ||
        !job.steps?.some((step: any) => step.name === fixtureStep && step.status === 'completed' && step.conclusion === 'success')) return false;
    const inventoryArtifacts = await api(`actions/runs/${expected.run}/artifacts?per_page=100`);
    if (!Array.isArray(inventoryArtifacts.artifacts) || inventoryArtifacts.total_count !== inventoryArtifacts.artifacts.length) return false;
    const artifacts = inventoryArtifacts.artifacts.filter((item: any) => item.name === artifactName(expected.attempt));
    if (artifacts.length !== 1 || artifacts[0].expired !== false ||
        !Number.isSafeInteger(artifacts[0].id) || artifacts[0].id <= 0 ||
        !Number.isSafeInteger(artifacts[0].size_in_bytes) || artifacts[0].size_in_bytes <= 0 || artifacts[0].size_in_bytes > 1024 * 1024) return false;
    return matches(await read(artifacts[0].id), expected);
  } catch { return false; }
}
export async function alreadyPassed(cwd: string): Promise<boolean> {
  // Local/manual/Linux paths neither query nor accept hosted evidence.
  if (process.platform !== 'darwin' || !process.env.GH_TOKEN) return false;
  try {
    const expected = identity(cwd);
    if (!trusted(expected, process.env)) return false;
    const api = async (path: string) => {
      const response = await fetch(`https://api.github.com/repos/tryapparent/apparent/${path}`, {
        headers: {Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json'},
        signal: AbortSignal.timeout(3000)});
      if (!response.ok) throw Error(`Installation evidence lookup: ${response.status}`);
      return response;
    };
    const passed = await lookup(expected, async path => (await api(path)).json(), async id => {
      // Hosted Mac only; mkdtemp creates a private job under the runner's OS temp root.
      const directory = mkdtempSync(join(tmpdir(), 'apparent-dev-install-evidence-'));
      try {
        const archive = join(directory, 'evidence.zip');
        writeFileSync(archive, Buffer.from(await (await api(`actions/artifacts/${id}/zip`)).arrayBuffer()));
        return JSON.parse(execFileSync('unzip', ['-p', archive, 'mac-install-contracts.json'],
          {encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 3000}));
      } finally {rmSync(directory, {recursive: true, force: true});}
    });
    return passed && matches({schema: 1, ...identity(cwd)}, expected);
  } catch { return false; }
}
