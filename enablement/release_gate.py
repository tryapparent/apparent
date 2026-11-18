#!/usr/bin/env python3
"""Admit exact verified publication commits; main is the default policy.

The approved onboarding Preview exception is repository/branch/platform bounded.
A successful PR check or an older selector-only workflow cannot admit a release.
"""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path

# Historical verification receipts remain valid after manual Mac workflow retirement.
# New Mac verification is discovered through checks.yml below.
WORKFLOWS = {
    'linux': '.github/workflows/verification.yml',
    'macos': '.github/workflows/verification-mac.yml',
}
REQUIRED = {
    platform: {'verify / select', f'verify / desktop-ui ({runner})',
               f'verify / rust ({runner})', f'verify / connect-client ({runner})',
               'verify / Release verification'}
    for platform, runner in [('linux', 'ubuntu-24.04'), ('macos', 'macos-15-intel')]
}


def api(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], text=True))


def pages(path, fetch):
    result = []
    for page in range(1, 101):
        data = fetch(f'{path}{"&" if "?" in path else "?"}per_page=100&page={page}')
        key = 'jobs' if '/jobs' in path else 'workflow_runs'
        result.extend(data[key])
        if len(result) >= data['total_count']:
            return result
        if not data[key]:
            break
    raise ValueError('Incomplete verification history; refusing publication')


def verified_run(repo, sha, platform, run_id, fetch, *, run_attempt=None, onboarding_candidate=False):
    prefix = f'repos/{repo}'
    workflow = WORKFLOWS[platform]
    exact = fetch(f'{prefix}/actions/runs/{run_id}') if run_id else None
    if run_id and (str(exact['id']) != str(run_id) or
                   (run_attempt is not None and (str(exact['run_attempt']) != str(run_attempt)
                                                 or exact['path'] != '.github/workflows/checks.yml'))):
        raise ValueError('Verification run or attempt changed after admission')
    if not onboarding_candidate:
        cd_runs = ([exact] if run_id else
                   pages(f'{prefix}/actions/workflows/checks.yml/runs?head_sha={sha}&branch=main&event=push', fetch))
        for candidate in sorted(cd_runs, key=lambda run: run['id'], reverse=True):
            run = exact if run_id else fetch(f'{prefix}/actions/runs/{candidate["id"]}')
            if run['path'] != '.github/workflows/checks.yml':
                continue
            jobs = pages(f'{prefix}/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs', fetch)
            policy = Path(__file__).resolve().parents[1] / 'shared/enablement/ci/release-admission.ts'
            accepted = subprocess.check_output(
                ['node', '--experimental-strip-types', str(policy)], text=True,
                input=json.dumps(dict(run=run, jobs=jobs, repo=repo, sha=sha, platform=platform)))
            if json.loads(accepted):
                return
    branch = 't3/onboarding-mac-release-baseline' if onboarding_candidate else 'main'
    events = {'workflow_dispatch'} if onboarding_candidate else {'push', 'workflow_dispatch'}
    if run_id:
        runs = [exact]
    else:
        filename = workflow.rsplit('/', 1)[1]
        runs = pages(f'{prefix}/actions/workflows/{filename}/runs?head_sha={sha}&branch={branch}', fetch)
    # Never accept another commit, fork, workflow, branch/event or old attempt.
    for candidate in sorted(runs, key=lambda run: run['id'], reverse=True):
        run = exact if run_id else fetch(f'{prefix}/actions/runs/{candidate["id"]}')
        if not (run['repository']['full_name'] == repo
                and run['head_repository']['full_name'] == repo
                and run['path'] == workflow and run['head_sha'] == sha
                and run['head_branch'] == branch and run['event'] in events
                and run['status'] == 'completed' and run['conclusion'] == 'success'):
            continue
        jobs = pages(f'{prefix}/actions/runs/{run["id"]}/attempts/{run["run_attempt"]}/jobs', fetch)
        successful = {job['name'] for job in jobs
                      if job['status'] == 'completed' and job['conclusion'] == 'success'}
        required = REQUIRED[platform] | ({'onboarding-candidate'} if onboarding_candidate and platform == 'macos' else set())
        if required <= successful:
            return
    raise ValueError(f'No successful {platform} {branch} verification for this exact commit')


def git(*args):
    return subprocess.check_output(
        ['git', *args], text=True, timeout=60,
        env={**os.environ, 'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_GRAFT_FILE': '',
             'GIT_TERMINAL_PROMPT': '0'},
    ).strip()


def canonical_main():
    url = 'https://github.com/tryapparent/apparent.git'
    if git('ls-remote', '--get-url', url) != url:
        raise ValueError('Canonical GitHub URL is rewritten')
    ref = git('-c', 'http.followRedirects=false', 'ls-remote', '--exit-code', '--refs', url, 'refs/heads/main')
    match = re.fullmatch(r'([0-9a-f]{40})\trefs/heads/main', ref)
    if not match:
        raise ValueError('Expected the exact canonical main ref')
    return match[1]


def require_main_ancestry(repo, sha):
    if repo != 'tryapparent/apparent':
        raise ValueError('Release requires the canonical repository')
    try:
        if git('rev-parse', '--is-shallow-repository') != 'false':
            raise ValueError('Release requires a full-history checkout')
        main = canonical_main()
        if any(git('cat-file', '-t', oid) != 'commit' for oid in (sha, main)):
            raise ValueError('Expected exact commit objects for candidate and canonical main')
        git('merge-base', '--is-ancestor', sha, main)
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError('Cannot prove verified commit is on canonical main; check local history and the live ref') from error


def admit(repo, sha, run_id=None, fetch=api, platform='linux', *, run_attempt=None, onboarding_candidate=False):
    if platform not in WORKFLOWS:
        raise ValueError('Expected linux or macos publication platform')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid repository')
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise ValueError('Expected an exact commit SHA')
    if run_id is not None and not str(run_id).isdigit():
        raise ValueError('Invalid verification run ID')
    if run_attempt is not None and (not run_id or not re.fullmatch(r'[1-9][0-9]*', str(run_attempt)) or onboarding_candidate):
        raise ValueError('Invalid verification run attempt')
    if onboarding_candidate and (repo != 'tryapparent/apparent' or platform != 'macos'):
        raise ValueError('Onboarding exception is only for this repository Mac Preview')
    platforms = ['linux', 'macos'] if onboarding_candidate else ['linux']
    for required in platforms:
        verified_run(repo, sha, required, run_id if not onboarding_candidate or required == platform else None, fetch,
                     run_attempt=run_attempt, onboarding_candidate=onboarding_candidate)
    if onboarding_candidate:
        baseline = '75dc870c240e415820384ced32f4390f798615bc'
        status = fetch(f'repos/{repo}/compare/{baseline}...{sha}')['status']
        if status != 'ahead':
            raise ValueError('Candidate must descend from published Preview 0.12.1')
        live = fetch(f'repos/{repo}/git/ref/heads/t3/onboarding-mac-release-baseline')
        if live['object']['type'] != 'commit' or live['object']['sha'] != sha:
            raise ValueError('Candidate branch moved after verification')
        return sha
    require_main_ancestry(repo, sha)
    return sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=sorted(WORKFLOWS), required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--run-id')
    parser.add_argument('--run-attempt')
    parser.add_argument('--onboarding-candidate', action='store_true')
    args = parser.parse_args()
    if (not args.onboarding_candidate and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('GITHUB_REF') != 'refs/heads/main'):
        raise ValueError('Release must run on canonical main')
    sha = admit(os.environ['GITHUB_REPOSITORY'], args.sha, args.run_id, platform=args.platform,
                run_attempt=args.run_attempt, onboarding_candidate=args.onboarding_candidate)
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'sha={sha}\n')
    print(f'Admitted verified commit {sha}')


if __name__ == '__main__':
    main()
