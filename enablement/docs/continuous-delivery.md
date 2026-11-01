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

The active website job now publishes only `public/site/dist-apparent` to the isolated
`apparent-capture` Pages project, using `public/site/scripts/cd/publish_pages.py` and
`public/site/wrangler.pages.jsonc`. It does not execute `public/site/wrangler.jsonc`, deploy the
hosted Worker, or connect to Clanker. See
[`../public/site/docs/pages-deploy.md`](../public/site/docs/pages-deploy.md) for the current build,
accepted-homepage reconciliation, video limits, exact hostname cutover and rollback.
Set `WEBSITE_PAGES_API_TOKEN` in `website-production`; the existing
`WEBSITE_CD_ENABLED=true` gate enables only Pages. Remove obsolete SSH settings
when present; they are no longer read. The hosted activation gate is unchanged.

### Retired Clanker capture-site origin

After canonical Pages acceptance, the capture site's Caddy serving block,
release symlink and historical release directories were removed. Do not restore
the old DNS A record, configure website SSH credentials, recreate that release
tree or run historical overlay activators. Production `publish_site.py` already
rejects this root; its temporary-filesystem tests are not a deployment procedure.
Use only the Pages rollback in `public/site/docs/pages-deploy.md`.

The proxy is shared. Its container, volumes, unrelated sites and separate
document-product poller/deploy-control services remain in place. They must not
be removed as capture-site cleanup. The website publication lock remains as an
inert coordination inode; there is no active capture website behind it.

## Hosted activation (separate operator gate)

Complete [`../connect/service/README.md`](../connect/service/README.md)'s deployment prerequisites
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
`connect/service/wrangler.cd.json` next to the existing entrypoint. The fixed production
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
`(cd connect/service && node_modules/.bin/wrangler deploy --config wrangler.cd.json --dry-run)`.
This proves configuration and packaging only, not permissions or deployment. Never
put real tokens in test fixtures, the generated file, artifacts, or logs.
