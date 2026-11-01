# Website and Connect continuous delivery

`.github/workflows/web-delivery.yml` checks website/Connect/hosted changes on PRs,
relevant pushes to `main`, and manual dispatch. It never publishes from PRs or
non-`main` dispatches. The two production jobs have independent activation gates
and GitHub environments. **Both are off until their repository variable is exactly
`true`.** This change prepares delivery; it does not merge, provision, migrate,
change a plan, or activate production.

## Checks and artifact identity

The credential-free verification job runs:

- `python3 -m unittest discover -s scripts/cd -p 'test_*.py'`;
- the complete hosted TypeScript build and real local workerd/D1/R2 suite;
- the website's frozen Bun install, public build, allowlisted `dist-apparent`
  packaging, and six-file public website suite;
- Connect's browser scenarios against a synthetic credentialed cross-origin API.

Node 22.23.0 and Bun 1.3.10 are pinned. Browser installation uses the version of
`playwright-core` in the website lockfile. Production is built with
`VITE_HOSTED_API_ORIGIN=https://hosted.tryapparent.com`. The production artifact
is saved **before** a separate loopback-configured browser build. The loopback
package is never uploaded for deployment. Artifact download is scoped to the
same workflow run and named with its event SHA. Production runs are serialized
without canceling a deployment halfway through; each publisher also refuses a
candidate that is no longer current `main`. A relevant later push supplies the
replacement; otherwise dispatch the workflow on `main` after reviewing it.

## Website activation: Cloudflare Pages

The active website job now publishes only `site/dist-apparent` to the isolated
`apparent-capture` Pages project, using `scripts/cd/publish_pages.py` and
`site/wrangler.pages.jsonc`. It does not execute `site/wrangler.jsonc`, deploy the
hosted Worker, or connect to Clanker. See
[`../site/docs/pages-deploy.md`](../site/docs/pages-deploy.md) for the current build,
accepted-homepage reconciliation, video limits, exact hostname cutover and rollback.
Set `WEBSITE_PAGES_API_TOKEN` in `website-production`; the existing
`WEBSITE_CD_ENABLED=true` gate enables only Pages. Remove obsolete SSH settings
when present; they are no longer read. The hosted activation gate is unchanged.

### Historical Clanker protocol (not an active publisher)

The following documents the retained origin and older rollback receipts only.
Do not activate the SSH publisher: its production `publish` operation now refuses
the Clanker release root. Keep the infrastructure and prior releases intact.

1. Review the live Caddy topology and allowlist in
   [`../site/docs/clanker-deploy.md`](../site/docs/clanker-deploy.md). The target is
   Clanker's existing `/opt/presentations/releases/apparent-site` symlink, **not**
   `site/wrangler.jsonc`, Pages, or a wholesale `dist` upload. Reconcile any
   approved live-only homepage changes into source before enabling whole-page CD.
2. Create a dedicated unprivileged SSH deployment user with access only to its
   staging directory and the site's release tree. It must not have Docker, sudo,
   other presentations, backend secrets, or Caddy-configuration privileges. The
   release tree must be readable by Caddy and writable by this publisher. Do not
   make it world-writable. Use a deployment-specific key, never a personal key.
   GitHub-hosted runners must be able to reach this SSH endpoint; do not widen a
   private endpoint merely to satisfy this workflow. If needed, arrange an
   approved private-network connection first.
3. Configure the `website-production` environment. Restrict deployment branches
   to `main`; use required reviewers if desired. Set environment variables
   `WEBSITE_SSH_HOST`, `WEBSITE_SSH_USER`, and environment secrets
   `WEBSITE_SSH_KEY`, `WEBSITE_KNOWN_HOSTS`. Pin the host key from a trusted channel;
   the workflow does not trust a fresh `ssh-keyscan` result.
4. Before activation, explicitly verify that Caddy permits the canonical and
   legacy account/device routes, their three approved `/hosted/*-v4.png` art paths,
   and the website's existing public assets. Do not expose the feature map,
   prototypes, release directory, or every pathname. CD never edits Caddy or
   native update/release routes.
5. Set repository variable `WEBSITE_CD_ENABLED=true`, then dispatch on `main`.
   Verify the actual runner, uploaded receipt, ordinary public routes, and
   desktop/mobile behavior before declaring delivery operational.

The publisher stages a fresh copy of the active release, overlays only the public
package, preserves all other bytes (including installers, appcasts, and old hashed
assets), and refuses same-name/different-byte `assets/` collisions. It holds the
existing `.apparent-site-publish.lock` from baseline capture through staging,
current-main checks, atomic switch and public byte checks. Every other publisher
and rollback must use this lock too. It does not protect against hostile same-UID
writers or publishers that ignore the protocol. Packages and baseline releases
must have no symlinks or special files; staging must be private to the deployment
account. No input tar archive is extracted remotely.

A failed public byte check restores the old symlink only if this candidate is
still active, and fails the job. A full inventory/rollback receipt stays outside
the served tree at `releases/.apparent-site-cd-*.json`; only revision and target
paths enter the Actions receipt. Failed stages and old releases are retained for
inspection. Do not garbage-collect them without checking the active link and
rollback receipts. Successful incoming upload directories are deleted; failed
uploads may need operator cleanup under the dedicated user's `.cache/apparent-cd`.

Guarded manual rollback, as the deployment user, with the retained reviewed script:

```sh
python3 scripts/cd/publish_site.py rollback /opt/presentations/releases/.apparent-site-cd-<release>.json
```

It checks both inventories and refuses to overwrite any later deployment. Verify
public bytes afterward. Disable `WEBSITE_CD_ENABLED` before a manual repair if
necessary; disablement does not cancel an already running production job.

## Hosted activation (separate operator gate)

Complete [`../hosted/README.md`](../hosted/README.md)'s deployment prerequisites
first: approved Free-plan configuration and CPU proof, existing private Standard
R2 bucket, initialized D1/ledger, live Google/cookie/device/cron proof and security
review. A green local workerd suite is not those proofs. Do not activate this job
against an uninitialized database or change to Paid implicitly.

Configure `hosted-production`, limited to `main`, with:

| Kind | Name | Meaning |
| --- | --- | --- |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | Approved account ID |
| Variable | `HOSTED_D1_ID` | Existing initialized database UUID |
| Variable | `HOSTED_R2_BUCKET` | Existing private Standard bucket name |
| Variable | `HOSTED_GOOGLE_CLIENT_ID` | Approved Google OAuth client ID (public) |
| Secret | `CLOUDFLARE_API_TOKEN` | Least-privilege token for this Worker/deployment and binding reads |

The existing Worker's `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` stay in
Cloudflare. They are never supplied to Actions or rotated by CD. Restrict the token
as far as Cloudflare permits and review its actual access before activation.
`hosted_config.py` validates the required public identifiers and writes an ignored
`hosted/wrangler.cd.json` next to the existing entrypoint. The fixed production
origins retain hosted API/auth/callback and legacy transition CORS; the UI stays
on app. Observability, workers.dev and preview URLs remain off. No CPU override,
resource creation command, database migration or ledger initializer is run.

After separate approval, set repository variable `HOSTED_CD_ENABLED=true` and
dispatch `main`. Wrangler uses strict deployment and tags the version with the
checked SHA. Readback requires one 100%-traffic version with that exact tag and
an anonymous `/v1/session` response with the canonical credentialed CORS headers.
This read-only probe does not prove live Google sign-in, authenticated cookies,
uploads or native integration. Inspect those separately before calling it live
acceptance. A failed readback fails the job; it does **not** silently change
traffic again or roll back a database. Disable the gate and use Cloudflare's
reviewed Worker version rollback after investigating; record the previous version
before the first activation. Website and Worker publication are independent, not
a distributed transaction. Protocol changes must retain backwards compatibility
or use a separately reviewed release sequence.

## Local verification

Run the commands in the checks section from the repository root (the Node commands
from their package directories). For a no-network deployment wiring check, generate
configuration using **synthetic** identifiers and run
`hosted/node_modules/.bin/wrangler deploy --config hosted/wrangler.cd.json --dry-run`.
This proves configuration and packaging only, not permissions or deployment. Never
put real tokens in test fixtures, the generated file, artifacts, or logs.
