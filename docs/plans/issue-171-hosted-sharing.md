# Issue 171 implementation plan

Base: 676396128a978f2af14e1e6427ef2f29d00f4efb (#180), verified ancestor of this clean T3-owned worktree. Target: scoped committed/pushed feature branch and draft PR against main; no merge or deployment.

## Thin slices

1. Backend capability boundary (coordinator): additive migration, explicit owner reserve/reuse/revoke/list, capability-only single-capture GET routes, fail-closed storage budget, immediate read-time retention/revocation across manifest/thumbnail/assets/ranges. Real workerd RED then GREEN tests.
2. Native explicit sharing (Luna worker, src/helper ownership): default-off hostedSharing, completed Copy link beside unchanged Paste, exact-capture onboarding resume, offline refusal/no deferred clipboard, baseline durable queue progress, stable reserved URL, settings/CLI management. Genuine RED then focused Rust tests.
3. Recipient evidence (Luna worker, renderer/site ownership): useful escaped no-JS evidence, pending/ready/failure states, machine/direct assets, bounded polling, preview metadata, browser owner management. Renderer/site RED then GREEN.
4. Integration: feature map/docs, concurrent and adversarial routes, broad hosted tests and offline Rust suite/build. Freeze committed SHA for security/lifecycle review and resolve blockers.
5. Platform and delivery: exact-build Linux GUI in isolated Omarchy VM; applicable Mac compilation/native checks when accessible. Inspect synthetic bundle text/visuals and record actual feature walkthrough via make-it-apparent. Preserve explicit unavailable gates. Verify branch, draft PR readback, and T3 PR registration.

## Shared wire contract

- POST /v1/captures/:id/share (upload bearer) after private reservation returns {url,status,expiresAt}. Repeated call reuses active capability; revoked re-share creates new secret.
- GET /v1/shares (owner bearer or browser session) returns {shares:[{id,captureId,url,status,createdAt,expiresAt,title}],nextCursor:string|null}; follow `before=nextCursor` until null.
- DELETE /v1/shares/:id (upload bearer or browser session + CSRF) revokes without deleting capture.
- GET /s/:64hex capability, /manifest.json, /thumbnail.png, /files/:allowlisted-path; no account credential accepted as capability. All content read-only and scoped.
- Public storage reads always use existing getObject budget gate. No public R2 URLs or schema reseed.

## Acceptance evidence

Track tests by command/raw log, source SHA, actual executed count and platform. Deployment, Google login, remote CPU/free billing bounds are not inferred from local workerd proof. No real accounts, private captures or live runtime mutations are authorized.
