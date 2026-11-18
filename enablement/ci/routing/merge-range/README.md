# CI range selection and batch integration

Hosted PR range callers compare `github.sha^1` with the checked merge commit,
not the event's potentially older `pull_request.base.sha`. GitHub can refresh
that merge ref after main advances while keeping the event base unchanged.
Comparing those mismatched revisions includes unrelated main changes (including
shared routing edits) and can select every native producer. This retains the
complete proposed-merge delta, both rename sides and conservative unknown/type
handling. Pushes still use `event.before`; exact-main admission, independent
stream receipts and publication inputs are unchanged. Missing merge history
cannot establish an exemption. `routing/engine-inputs/merge-range.test.ts` exercises the actual YAML
expressions and selector CLIs against committed diverging branches and merges.

Reproduction: PR #1385 head `8512c7c2a845695e3cf7780d807ee92dbfa5c86b`,
Engine run `44050483707`, selector job `133926755405`, checked merge
`69ce247aaf783e547623f104fdc7373e0d209acd`. The event base was
`aacc692b34b906630cc8a6187f32507ab680faa5`; the actual merge parent was
`f91d2d57f1d367c89167e69d30ce603237eea0d6`. The stale comparison included
main's shared `consumers.ts` edit and selected all 13 suite flags. The corrected
comparison contains only `verification-platform.yml` and `mac-platform.test.ts`:
root, legacy Engine, Desktop, client, tools and tooling remain; independent
Engine media, foreground, browser, service, Hermes, Public and onboarding omit.
The independent Engine workflow therefore skips SDK and all four native lanes
(Ubuntu x64/ARM and Mac Intel/ARM), retaining cheap selection. Its source producer
remains `engine/tools/check.ts`, with isolated native manifest/lock and SDK package;
no root/Connect receipts replace those checks. Root/Connect native duplication,
exact-tree receipt authentication and main publication coverage are unchanged.
Three already completed Engine native jobs occupied 432 seconds combined
(241 Intel Mac, 92 Ubuntu ARM, 99 Ubuntu x64); Mac ARM was queued at observation.
Those include setup/execution/cleanup and are not a post-fix timing benchmark,
queue saving or forecast. The correction changes selected allocations; it does
not eliminate upstream path-filter workflow admissions.

Explicit finite CI batches may combine released, compatible source commits into
one reviewed integration PR. Freeze membership, record source owners/refs/heads,
the exact main base, source-only commits, exclusions, conflict decisions and the
sealed combined head/tree in the PR manifest. Retain the union of required tests,
native receipts and publication gates; source proof is reusable only for unchanged
inputs. Preserve any running frozen push until terminal. Source owners hold
independent delivery; supersede their PRs only after the accepted combined merge
and exact-landed verification/publication. One main merge produces one candidate
per applicable workflow, not a promise of one workflow. This is a manually
requested batch, not a coordinator, standing queue or policy exemption.
