# Native retention test audit

Baseline: `6de4cfb23740bbf31348726c69a0337bc3d385d5`. Scope is the native
retention adapter and media-file admission/replacement tests under
`capture/engine/bundle/retention`. Record owns the age/bitrate policy and its
separate headless tests; native filesystem and codec boundaries remain distinct.

Read the native planner, observer, apply/shrink/sweep/worker, descriptor-anchored
video admission/replacement, actual composition request/decoder, Record policy
and worker, and Mac helper/shrink implementation before judging the changes.
The video test module precedes its implementation in the file; after encountering
it, the production implementation was read before making these decisions.
Broader recovery/audio and Desktop helper transport audits remain separate.

## Contracts retained

R retains a named contract, F repairs a weak fixture and D removes support that
does not supply an independent contract. No declaration or parameter row is cut.

| Native retention case / distinct controls | Decision and credible regression |
| --- | --- |
| Planning manifest traversal, absolute path, linked video and linked bundle, with valid inside positive | R: external media becomes shrinkable or a linked bundle is traversed |
| Direct shrink escape, traversal and symlink | R: a public caller reaches probe/encoding before file admission; outside bytes and absence of intermediates remain checked |
| Leftover sweep: claimed active directory, stale directory, legacy file, then released claim | R: an encoder's partial is deleted or stale debris survives after ownership ends |
| Failed-attempt timing: frequent wakes, full period, old success, sleeping/backward wall clock | R: a failed pass becomes a rapid retry loop or sleeping prevents cleanup forever |
| Real Engine small-movie observation | R: direct shrink rewrites already-small video or leaves intermediates |
| Real Mac shrink: actual High-profile input, smaller nonempty output, dimensions/duration, unrelated sentinel and cleanup | R: codec admission hides native encoder failure, source replacement is wrong or private output survives. Keep the real platform case. |
| Isolated after-capture job with actual high-bitrate small movie | R: Record eligibility or native size observation is bypassed, manifest/source changes, or the real job ignores a valid request. The subprocess avoids unrelated process-wide Recording guards; no retry is added. |
| Policy read: missing file, explicit null, unrelated keys, partial defaults and unknown policy field | R: compatibility/defaults change or an explicit keep-forever becomes cleanup |
| Old media and older bundles: exact ordered actions/items, fresh/week exclusions, derived media, forever and zero-day floor | R: prompt evidence is selected as heavy media, age precedence changes or a short policy bypasses the day floor |
| Pinned, pending, sending, occupied/refused claim, release and stale marker | R: active work is selected, a refused duplicate claim releases the original, or an abandoned copy blocks cleanup forever |
| Recently changed folder: before/after settlement | R: copied old bundles are immediately deleted or never become eligible |
| Apply: real rename into owned fake Trash, reports/freed bytes, whole bundle, media grouping, prompt files, unchanged manifest, cleanup note and next pass | R: cleanup removes the prompt, misreports success, leaves staging or selects the same media again |
| Native iPhone mirror only: screen/small exclusions, hours/minutes, cleanup precedence | R: non-native/low-bitrate/recent media is encoded or due-for-trash media wastes an encode |
| Human byte formatting, MB/GB | R: storage output changes units or precision |
| Private staging under permissive umask in an isolated child | R: temporary encoded media is exposed or the privacy assertion changes the main test process |
| Nested regular media replacement, exact bytes, permission preservation and staged removal | R: ordinary admitted media cannot be replaced or permissions/ownership of the staged file are lost |
| Input empty/dot/traversal/absolute, linked file/ancestor/root, directory and FIFO, plus outside bytes | R: file admission follows links, escapes or blocks on a special file |
| Source contents/inode/parent/root rebinding, current source and staged bytes | R: replacement overwrites a changed source or crosses a rebound directory |
| Encoder symlink/hardlink/size/empty/traversal, unchanged source | F: use an existing size-matched outside file for symlink and traversal. The old symlink was also the wrong size; the old traversal target did not exist. Both could pass before reaching their intended guard. |

The composition decoder's version, kind, extra-field and bounded/unique index
checks are also read and retained; the whole Composition lane is not complete.
No native safety contract is exchanged for headless policy coverage.

## Support consolidation and budget

D: remove the custom temporary-directory type and use the existing `tempfile`
owner at all six callers. Its lexical scope still outlives each synchronous
operation, while removing duplicate creation/drop code and using private roots.
No dependency or production seam is introduced.

The planning/rename-only bundle fixture now uses file length instead of allocating
and writing 25 MB of zeroes per phone. Its logical bytes/size remain the same;
these callers inspect metadata or rename files, never decode the fake movie.
The actual encoded movie, Engine observation and native shrink fixtures remain
unchanged. This avoids the allocation/write by construction; no wall-time speedup
measurement is claimed.

Test/support: 41 added, 60 removed, net **-19 lines**. All 19 declarations remain
(18 Linux, one additional Mac case), including every existing parameter row.
Two added fixture lines repair distinct output admission guards. Production,
manifests, lockfiles and runtime policy are unchanged.

## Evidence and remaining gates

Baseline evidence: all 18 native retention cases passed in the complete hook at
`c93e8bee8`. Relevant retention, Record policy/worker, composition, Rust helper and
Swift shrink sources are byte-identical to this slice's pinned baseline; the
unrelated export test changes in that hook do not supply retention coverage.
Fresh candidate checks through the normal locked offline Cargo runner pass all
18 cases with two test threads; real Record/Engine workers and movies are used.

Copied actual-source sensitivity: removing the member `O_NOFOLLOW` guard passes
the old encoder-refusal case, then fails the keeper at `symlink`. Removing only
the staged-name guard passes the old case, then fails at `traversal`. Restored
source passes all 18 cases with one test thread. Only a disposable source copy
was mutated, using its private Cargo target and actual staged Record/Engine
workers plus Electron. The delivery target is never used by the copied probe.

Disposable recipes/logs: `/tmp/apparent-dev-engine-audit-0H13BY/retention-probe.ts`,
`retention-keeper.log`, `retention-*-mutant.log`, `retention-restored.log` and the
baseline `export-evidence-push.log`. Regenerate them if cleaned.

Independent code-only preservation review at `c7f774b34` found no blocking
security/logic issue, lost contract or suggestion. It independently checked the
frozen source diff and callers, without rerunning tests or validating probe logs.
Normal hook/hosted/exact-main delivery remains pending. No local Mac/native
encoder, live capture, GUI, sealed package or clean
owner build independence is claimed. Existing in-process claims do not establish
cross-process serialization; broader recovery/audio mutation lifetimes remain
for those owners' audits. Existing automatic CI publication is authorized; no
manual release is triggered.
