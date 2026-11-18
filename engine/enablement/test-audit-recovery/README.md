# Recovery and publication test audit

Baseline: main `aacc692b3`. Preserve the incoming Record speech-cue producer and
its actual assembly caller; the five relevant native inputs match `d3b2cf897`.
All 53 baseline declarations passed the successful normal hook at `bec23d329`,
whose native inputs are identical. The candidate's 50 retained cases and three
actual-source fault controls pass against the current producer in a private tree.
Code-only preservation review approved the candidate; normal hook/hosted/exact-
landed delivery remain pending.

Read recovery, assembly, publication filesystem/container/validation/cleanup,
actual completion/dispatch and optional whiteboard publication, pending transcript
producer and real Record transcript adapter/policy before deciding changes.
Adjacent tests encountered during those reads were reread after the owner source.
The visual renderer and native capture are separate acceptance boundaries.

53 baseline declarations become 50: two obsolete units retire their unused
native helpers, and overlapping rollback coverage moves into its stronger keeper.
The change removes 68 test/support lines and 50 dead native/import lines. These counts
are consequences, not targets. No independent guard is removed to fund growth.
Fixtures use existing tempfile ownership; no manifest or dependency changes.

## Recovery (`recover.rs`)

| Baseline test | Decision and retained contract |
|---|---|
| microphone_intent_survives_journal_replacement_and_manifest_handoff | R; JSON microphone intent and unrelated context survive journal replacement and journal-free manifest read. Explicit fixture removal replaces dead-helper call. |
| legacy_microphone_marker_is_fallback_only_and_bad_json_is_not_ignored | R; manifest wins over legacy intent; malformed journal refuses rather than silently falling back. |
| legacy_admission_is_consumed_into_json_before_media_start | R; migrate legacy intent once, preserve existing journal on repeated admission and reject unexpected marker bytes. |
| a_bundle_without_its_manifest_is_rebuilt_once_after_it_settles | R; exact recipe/defaults, settling gate, built/tried/empty exclusions and completed-journal disappearance. |
| recovery_preserves_video_ink_facts_without_guessing_old_sources | R; separately retain absent, captured, capturedVideo and excluded rows through persisted rebuild and target preservation. |
| recover_picks_up_old_video_and_audio_without_a_journal_but_never_a_live_capture | R; separate orphan settling gate, live/missing-audio/built/tried/phone exclusions and journal precedence. |
| interrupted_screen_recording_never_recovers_raw_movie | R; intended unsafe-video diagnostic, no artifact, persistent guard and no automatic discovery. |
| screen_capture_refuses_reused_or_recoverable_directory | R; occupied original bytes/recoverability survive; a fresh directory is accepted and cannot be reused. |
| completed_screen_bundle_removes_its_pre_recording_guard | C; transfer unsafe-only success removal to actual publication cleanup, then retire unused recover::finished. The donor currently writes invalid empty manifest and calls no live finalizer. |
| recover_rebuilds_a_bundle_from_its_video_and_audio_alone | R; actual saved artifact/schema, scene-change frame, transcript, absolute media clocks, no crop/ink inference and no repeated rebuild. |
| recover_tries_an_orphan_once_and_retries_only_when_asked | R; provider failure preserves retry marker, suppresses auto-discovery and permits explicit retry. |
| recover_rebuilds_a_real_movie | R; real FFmpeg synthetic movie through actual Record/Engine media providers and decoded blue output pixels; no fake decoder substitution. Mac execution remains separate. |

RAII replaces fixed-name/PID predeletion and manual/absent cleanup. A four-line
shared fixture recipe creates mode-0700 roots explicitly: tempfile 3.27 defaults
to mode 0777 before umask, so ordinary group-write defaults fail the production
parent trust gate. The existing cleanup tests independently reproduce that
fixture error; production permission checks remain strict. Remove duplicate
mkdir/chmod before actual publication::write, which already creates private roots.
Keep every fixture owner alive through synchronous provider work. No real capture
or user directory is used.

## Assembly (`bundle_processing.rs`)

| Baseline test | Decision and retained contract |
|---|---|
| movie_without_safe_screenshots_is_not_a_bundle | R; raw movie cannot become a success or recover later; bytes remain and privacy guard persists. |
| typed_notes_survive_bundle_reload_and_reprocess_without_transcript_or_duplicates | R; semantic multi-line note, microphone context, legacy marker migration and exactly one note survive publication/reprocess. |
| video_only_bundle_discloses_telemetry_gap_after_reload | R; literal wire fact and disclosure persist across disk reload; absent older fact stays absent. |
| demo_bundle_saves_finish_trace_without_configuration | R; real demo caller publishes timing trace by default. |
| finish_trace_contains_only_timings | R; finite diagnostic schema protects capture privacy; not redundant with default caller proof. |
| artifact_failures_do_not_publish_a_manifest | D; only caller of unused runtime::write_bundle_artifacts. The legacy missing-parent refusal/empty-frame writer behavior is not a live product contract. Retire writer and cfg(test) import. Live corrupt-PNG refusal, failed persistence before manifest, safe-path admission and publication checks remain below. |
| full_keyframes_match_by_time_and_preserve_partial_decodes | R; out-of-order/clamped frames match by timestamp, preserve requested clock and retain candidate for missing decode. |
| failed_full_decode_explains_candidate_frames_in_written_summary | R; persisted and regenerated quality disclosure survives reload and later note edit. |
| decoder_fallback_keeps_moving_target_in_agent_images | R; fallback forbids idle-cursor cropping and preserves actual moving red target pixels in images and sheet. |
| unfinished_captured_ink_keeps_full_frames_and_both_quality_warnings | R; captured source facts, actual mark semantics, original resolution and both independent warnings survive. |
| successful_full_decode_keeps_normal_autocrop | R; positive real-policy crop control and saved full-resolution frame prevent fixing fallback by disabling crop globally. |
| partial_full_decode_keeps_both_resolutions_uncropped | R; mixed decoded/candidate resolutions survive together and disable unsafe crop. |

## Publication core (`publication/tests.rs`)

All ten declarations remain R, with every existing parameter:

| Test | Independent failure |
|---|---|
| publication_rejects_replaced_lock_on_reentry_and_final_cleanup | Replacing persistent lock inode must refuse both reentry and late cleanup, keeping pending marker. |
| publication_coordination_blocks_other_threads_until_last_guard_in_either_drop_order | Nested reentrant leases must retain exclusion until final release in either drop order; fresh reacquisition must work. |
| publication_checks_real_image_audio_movie_and_exact_manifest_inputs | Actual PNG/WAV and independent MP4/MOV fixtures validate; corrupt artifact/summary refuses and exact manifest identity survives. |
| publication_rejects_movie_with_valid_boxes_but_truncated_sample_payload | Syntactically boxed MP4/MOV with missing media samples must refuse. |
| publication_rejects_nested_symlinks_traversal_and_replaced_artifacts | No linked nested artifacts/path escape, including replacement after inventory, and unchanged outside bytes. |
| publication_holds_final_mutations_and_checks_fallback_before_return | Inner success cannot publish before optional mutation; corrupt versus restored fallback governs outer success. |
| publication_rejects_marker_cleanup_failure_and_readonly_leaf_without_root_bypass | Directory marker collision and unsafe file mode fail even under root; journal creation collision remains explicit. |
| publication_detects_postvalidation_manifest_replacement_before_cleanup | Late manifest replacement invalidates success and preserves pending work. |
| publication_rejects_bundle_directory_replacement_under_existing_writer_lease | Held lease cannot authorize a replacement directory. |
| publication_parent_sync_accepts_sticky_tmp_without_admitting_it_as_bundle | Root-owned sticky /tmp is syncable but not a bundle; unsafe owned directory is refused under both policies. |

`publication/cleanup.rs` retains its rollback declaration: after actual directory
rename/final-check failure, restore original recipe/pending/audio bytes through
the held directory. RAII owns original and moved paths. Its success declaration
retains a fresh **audio-only** row and absorbs a separate fresh **unsafe-only** row;
removing either marker must fail the corresponding row. This preserves singleton
cleanup admission rather than requiring both markers together.

[Continued audit](part-2/README.md)
