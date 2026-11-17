# Keyframe test audit

Baseline: main `7eb349abb` (native selection inputs identical to `f91d2d57f`).
Read the full native selector and its real assembly/phone callers, settled-event
producer, Record speech/text policies and finite adapters before all 25 tests.
The incoming Record speech-cue plan and estimated-timing row remain intact.
This slice audits selection, not all Engine, Record or rendering behavior.

25 declarations become 24; test/support delta **-10 lines**, production delta
zero. Two existing test helpers become an explicit native-image helper and a
real composition helper. Fifteen image-only call sites stop launching a text
worker; no data-dependent mock or production seam is introduced. Composition
fixtures still run the actual Record workers and published Engine package inputs.

## Decisions and retained contracts

| Baseline declaration | Decision / independent failure protected |
|---|---|
| ordinary_selection_uses_the_callers_allocation | R; separately honor caller allocations 1 and 2, independently of native maximum. |
| captured_freehand_allows_pixels_to_settle_after_the_last_input_point | R; real retained 8 ms versus settled sample clocks and actual line pixels, with no quality warning. Native mechanics helper. |
| captured_freehand_uses_a_settled_frame_without_changing_other_sources | R; captured, capturedVideo and unknown source retain different sampling behavior. |
| captured_freehand_reports_a_missing_settled_frame | R; retain latest available sample and warning; unknown-source control has no warning. |
| note_image_precedes_its_editor_and_keeps_original_click_anchor | F/D; retain pre-editor 900 ms image and mark-to-file binding for all three source rows; remove immutable input timestamp self-assertion. Persisted semantic note clocks remain protected by production publication/recovery tests, not that self-assertion. |
| luma_is_normalized_and_resolution_independent | R; black/white/half-gray normalization and 2×2 versus 128×72 sampling. Keep its fixture helper. |
| marks_on_one_screen_share_a_keyframe | R; click survives, grouped marks use later image/first mark ID and every mark binds to the numbered file. |
| every_mark_gets_a_keyframe_within_the_budget | R; all eight marks remain bound, nearest screens merge, later image survives, and long same-screen spans close into two groups. |
| scene_changes_select_the_settled_view | R; animation collapses into its final actual image and reason. |
| nearby_candidates_are_deduplicated_using_capture_times | F; physically distinct nearby clicks survive event coalescing, then selected clocks must be exactly [1250, 2500]. Keep index/file guards. The old shared-constant/count oracle was masked by an earlier event guard. |
| transcript_words_partition_without_duplicates_or_gaps | R/C keeper; real selection anchors and native-to-Record text allocation retain comma clauses; absorb the separate punctuation-at-next-frame input with identical word clocks and literal expected words. |
| segment_only_transcript_is_assigned_once | R; two segment assignments, static speech has no extra frames, long mark's early action anchor retains its words. Real workers remain. |
| spoken_cues_never_duplicate_an_unchanged_screen | R; unchanged-screen cue collapse, estimated-input initial fallback and order-independent scene/cue novelty. |
| short_comma_lead_in_stays_with_its_clause | R; short comma lead-in stays with the actual later selected click. |
| a_spoken_cue_finds_the_change_it_points_at | R; measured cue snaps to settled transition and both output text clauses survive. |
| estimated_word_times_do_not_cut_keyframes | R; actual Record plan never creates speech frames from estimated times on a changing screen. |
| an_action_mid_sentence_takes_the_sentence_from_its_start | R; actual click anchor retains the whole later sentence and separate earlier text. |
| flags_are_priority_keyframes | R; mark ID and original flag image win over a nearby click. |
| long_talk_over_a_changing_screen_gets_more_than_one_frame | R; bounded coverage includes early changes and text ownership stays bounded; unchanged-screen control remains one frame. Real text allocation remains. |
| a_long_lead_in_is_split_near_its_middle | R; native coverage balances the actual initial image gap instead of taking adjacent late changes. |
| groups_close_at_a_click_or_too_much_ink | R; retain independent click and stroke-count boundaries. |
| same_screen_merges_stay_balanced | R; six groups merge into three distinct balanced pairs with all file bindings. |
| nothing_cuts_into_a_drawing_session | R; a laser cannot split the grouped drawing; sole frame remains a mark. |
| fallback_and_empty_inputs | R/F; initial midpoint, zero allocation and empty frame input remain through real composition. Assert actual empty worker output remains None. This one boundary assertion supports separating image-only fixtures; no new declaration or fixture. |
| a_punctuation_token_at_a_keyframes_start_ends_the_one_before | C into transcript_words_partition_without_duplicates_or_gaps. Retain the native-to-Record boundary and exact punctuation/timing contract, now through real selected frames, rather than deleting it as a TypeScript policy duplicate. |

The fixed six ordinary slots in fixture helpers are explicit historical test
allocation, not a claim to protect Record's current default-budget policy. Keep
the real published-worker/schema/package and publication tests separately.

## Evidence

Private proof archive uses main `f91d2d57f` with the separately reviewed recovery
candidate; that candidate removes unused native helpers and changes fixtures,
not selector/Record production behavior. Its private target never shares the
delivery target. Final standalone branch/hook acceptance remains required.

- Baseline: all 25 exact keyframe IDs pass.
- Remove the actual selector spacing guard: old test still passes. The repaired
  keeper fails with duplicate selected clocks `[1250, 1250, 2500]`.
- Independently omit captured settling, mark-file binding or action anchors in
  native production: the retained corresponding keeper fails for that behavior.
- Omit Record's punctuation attachment rule in actual TypeScript policy, rebuild
  with the real compiler and stage its generated policy for the actual worker:
  the consolidated selection/allocation keeper fails its punctuation row.
  Restored compiled policy matches the original staged bytes exactly.
- Restore all sources: all 24 distinct keyframe IDs pass. `strace` of successful
  actual worker execs shows **34 transcript + 11 cue = 45** before, versus
  **15 transcript + 12 cue = 27** after. The extra cue call belongs to the stronger
  consolidated punctuation arrangement. No wall-time or hosted savings claim.
- Completion receipt passed: three non-model native streaming checks, two
  composition schema checks and nine Record text/cue/streaming headless cases.
  Ignored real-model/Metal tests are not claimed executed.

Disposable evidence: `/tmp/apparent-dev-engine-audit-0H13BY/keyframes-f91-*`,
`f91-stream-headless.log`, candidate map, execve traces and proof/resume helpers.
An initial proof-accounting assertion incorrectly expected the cue count to stay
constant after moving punctuation through selection. Its 25/24 passing case
executions and intended fault failures remain valid; the corrected completion
step checks the extra real cue call and executes only remaining checks.

Independent Luna preservation review approved the two staged files against
`7eb349abb` with no blocking findings. It independently verified HEAD, both blobs,
no unstaged differences and staged diff SHA-256
`16e6c27e4ac91b940915b51d7210057f89421a9d83386e22e5ba1ce6788a3906`.
It reviewed production, policies, adapters and all mapped test changes; it did not
independently execute the supplied private evidence. Only this review metadata
is appended afterward. Normal mandatory hook, hosted checks, merge and passing
CI on the exact landed commit remain pending. No native capture,
visual UI, permission, hardware, sealed package or installed-app acceptance claim.
No manual releases; existing automatic CI publication remains authorized.

Campaign queue: reviewed recovery/export/retention, Record and CI slices have
separate PR/delivery gates. Engine SDK/staged and Agent candidates still require
current-main integration. Shared Hex's 13 cases have been read, with permanent-
refusal retry assertions and server-thread ownership flagged for their own slice.
Other Desktop, Connect, Public, Hermes, Shared, Composition and Enablement areas
remain pending; these boundary reads do not mark those owners complete.
