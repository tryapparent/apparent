`publication/benchmark.rs` retains its single real-copy test: unchanged source
movie/manifest, no hard link, rejection of source/parent/child/symlink aliases and
already-existing destination. No destructive replacement is admitted.

## Production-entry, completion and transcript boundaries

All six `publication_tests.rs` declarations remain R:

- `publication_rejects_corrupt_prepared_png_before_success`: finalizer refuses actual corrupt prepared bytes.
- `publication_checks_wav_persistence_before_transcription_or_manifest`: occupied WAV path stops before manifest/provider work.
- `publication_screen_wrapper_checks_journal_and_keeps_required_audio`: separate journal-collision refusal and actual stored-WAV positive, precise target serialization and cleanup.
- `publication_rejects_external_and_symlinked_movies_before_decoder_callback`: both path forms refuse before decoder, with no manifest.
- `publication_finalizes_durable_typed_notes_with_matching_recovery_journal`: real screen finalizer reconciles note into exact journal-compatible manifest.
- `publication_recovery_reconciles_only_durable_typed_notes_before_journal_validation`: recovery retains earlier click/unrelated capture note and adds durable typed note before validating publication.

All four completion declarations remain R through actual shared wrapper,
whiteboard persistence and Desktop admission/receipt:

- `completion_whiteboard_success_is_checked_after_append_and_then_admitted`.
- `completion_failed_append_only_admits_the_intact_revalidated_fallback`.
- `completion_failed_rollback_or_corrupt_fallback_preserves_recipe_and_blocks_admission`: both failed rollback and independently corrupted fallback rows.
- `completion_marker_cleanup_failure_cannot_admit_an_intermediate_inner_success`.

Pending transcription has six baseline declarations:

| Test | Decision and retained contract |
|---|---|
| pending_publication_waits_for_outer_final_mutation_before_transcribing | R; actual writer coordination delays provider until outer publication releases. |
| record_text_allocation_publishes_with_transcription_and_rolls_back_as_one_bundle | F/keeper; absorb both fresh step-0/step-1 late failures. Require mutation reached, intended error, exact manifest+summary rollback, pending marker, successful real Record allocation, persisted words/transcript/summary, final validation and unchanged frame/audio bytes. |
| pending_error_retry_and_success_preserve_real_bundle_until_committed_update | R; provider error and retryable missing model preserve work; separate empty-transcript success clears pending. |
| failed_initial_barrier_never_starts_pending_transcription | R; invalid initial artifact blocks provider and keeps pending marker. |
| concurrent_pending_retry_revalidates_after_real_artifact_replacement | R/F; rename accurately and remove unused Arc. There is no concurrency in this fixture; its useful guard is actual audio-symlink refusal before provider invocation. |
| pending_publication_restores_both_text_artifacts_after_late_failure | C into Record-allocation keeper; retain both failure points, intended diagnostic and proof the first persistent mutation occurred. No second runtime replay is needed. |

## Required proof and delivery

Actual-source proof against current main `aacc692b3`:

- Omitting unsafe-video cleanup makes the keeper fail `retained .unsafe-video`;
  its separate durability rollback case still passes. The original two cleanup
  cases and finished-helper donor passed this omission at `e4506a3c6`; their
  cleanup/recovery mechanisms are byte-identical, so that old false-green
  control is reused without claiming fresh execution.
- Independently omit manifest or summary rollback in the real speech-model
  producer: the consolidated Record-allocation keeper fails `manifest must roll
  back at step 0` / `summary must roll back at step 1` respectively.
- Restore production exactly: all 50 distinct retained test IDs pass across
  recovery11, assembly11, publication13, production-entry6, completion4 and
  transcription5. Actual FFmpeg/Engine/Record composition and blue-scene pixel
  assertion remain executed. Duplicate probe executions are not extra cases.
- Baseline and restored candidate SHA-256 checks match the private map. Applying
  the candidate only removes one extra EOF blank line from that tested snapshot;
  executable tokens are unchanged. The normal hook will check the final bytes.
  Private worker inputs are real staged Record media, Storage owner and Electron
  runtime, not mock stand-ins. The private Cargo target is never the delivery target.

Disposable evidence under `/tmp/apparent-dev-engine-audit-0H13BY/`:
`recovery-current-main-probe.log`, `recovery-{keeper,restored}-*.log`, candidate
maps and `recovery-probe.ts`. Earlier logs and the pre-EOF-trim map are retained
separately. Regenerate after cleanup. The worker inputs are real staged products;
all private compilation uses its own target, never the delivery target.

Independent Luna preservation review approved the seven staged files against
`aacc692b3` with no findings (diff SHA-256
`91e41bb6f6089f125fd3b7e4661423c2400a745d61dd38b916c79348abe55178`).
It verified the staged/working identities and reviewed source, without rerunning
checks or independently inspecting private logs. Remaining gates: normal mandatory
hook, hosted checks, merge and passing CI for the exact landed commit. The fixtures use
the configured settlement intervals to construct before/after states; they do
not independently freeze the numerical delay defaults. No new timing contract or
test declaration is added. Existing deterministic publication-phase injection
remains necessary for the two real rollback failure points; no seam is added.

No new release, manual workflow dispatch, UI appearance, native capture,
permission or sealed-package claim. Automatic CI publication remains authorized.
Broader Engine/Desktop/Record/Composition audits and incoming upstream contracts
remain in the campaign queue; reading these boundaries does not finish those owners.
