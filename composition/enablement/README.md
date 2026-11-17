# Composition test cleanup ledger

## Headless resource adapters

Base: `d9b3af9d9b16d6c6b6e3651ceb300c1c01bc33cb`. Read production in
`movie_frames.rs`, `worker.rs`, `assembly.rs`, `screen_frames.rs`,
`transcript.rs` and `media_probe.rs` before classifying their retained tests.
Read the real Record phone/screen/assembly/transcript workers and their policy
contracts, Agent frame worker, published capability selection and native callers.
The media-probe adapter has no inline tests; its callers' owner audits remain
separate. Other Composition areas are still pending.

### Movie frames: five declarations retained

| Declaration | Decision and behavior |
| --- | --- |
| `candidate_clock_is_actual_unique_and_bounded_before_reading_pixels` | Fix the oversized row: 513 ordered, unique, matching clocks rather than 513 duplicate zeroes. Preserve valid clocks and all empty/negative/mismatch/duplicate/descending rows. The count cap now has its own effective guard. |
| `resource_backoff_preserves_order_and_does_not_repeat_other_failures` | Retain ordered duplicated bundle labels, typed resource-limit backoff, nonresource exit codes and terminal singleton resource failures. |
| `real_published_bridge_preserves_pixels_and_bundle_identity` | Retain real FFmpeg input, published Agent/Record workers, clamped and duplicate Record labels across batches, Agent RGB pixels/dimensions and source-byte preservation. |
| `private_pixels_keep_bundle_identity_and_reject_malformed_contracts` | Retain real private pixels, exact bundle identity, index/time/path/dimension refusal, empty response and truncated bytes. |
| `output_cannot_read_symlinks_or_hardlinks_to_other_private_files` | Retain both link types and unrelated source-byte preservation. These protect distinct filesystem mechanisms. |

The 512-frame bridge envelope is independent of Record's candidate cadence and
rounding overflow. An otherwise-valid oversized fixture must not also fail
uniqueness; the separate duplicate row remains useful and is not deleted.

### Worker resources: six declarations retained

| Declaration | Decision and behavior |
| --- | --- |
| `held_input_supports_bounded_text_replies_without_widening_small_worker_budgets` | Retain private 0600 held input, real 256 KiB round trip and oversized held-file refusal. Delete its repeated `run(..., 128 KiB + 1)` assertion; the envelope keeper below already checks that exact boundary before launch with the intended diagnostic. |
| `media_alias_is_private_and_preserves_filename_bytes` | Retain 0700 alias ownership and exact non-UTF-8 symlink target bytes. Real frame/metadata callers depend on this native path boundary. |
| `finite_output_is_returned_only_after_successful_exit` | Retain real finite stdout bytes and typed exit-7 refusal despite partial output. |
| `reader_and_descendant_cannot_hold_the_parent_past_its_deadline` | Retain real group/reader deadline and delayed-write refusal. Do not collapse descendant cleanup into output-count proof. |
| `continuous_output_is_bounded_independently_of_time` | Retain both 32/128 KiB envelopes and output-limit failure independent of timeout. |
| `finite_frame_envelope_fits_without_widening_metadata_or_unbounded_output` | Keeper: finite 64 KiB output is refused under the small budget and accepted under the frame budget; zero/oversized budgets reject before attempting an unavailable command. |

These are real local subprocess/filesystem boundaries, not unnecessary internal
mocks. Removing one repeated preflight assertion does not remove the held-input,
privacy, output, deadline, descendant or typed-error contracts.

### Assembly: one declaration retained

`accepts_record_allocations_within_the_native_envelope_without_reimplementing_defaults`
keeps its nondefault positive allocation and version, maximum, ordinary-above-
maximum, zero-maximum and unknown-field refusals. Add one otherwise-valid row
with maximum 9 and ordinary 0: the old zero/zero row fails the maximum check and
cannot independently guard the ordinary lower bound. The original zero-maximum
row stays. This is a distinct native allocation contract, not a second assertion
of Record's default policy.

### Screen pages and transcript: three declarations retained unchanged

`full_periodic_pages_survive_the_real_worker_transport` protects full phone and
multi-page screen replies, actual movie/bundle clocks, offset, pixels and source
preservation. `pages_require_explicit_continuation_and_refuse_cycles_or_invalid_cursors`
separately protects required continuation, unknown fields, terminal null, cursor
cycles, empty/oversized strings and wrong types. Neither replaces the other.
`response_is_versioned_and_matches_every_requested_frame` protects the native
transcript consumer's version/count/type/unknown-field refusals and text/null
payload. The TypeScript policy suite cannot replace these native DTO contracts.

### Cost, controls and delivery

All **15 declarations** in these five test-bearing modules remain. Movie fixture
repair: 0 test-line growth. Worker duplication: -1 line. New ordinary-floor
coverage: +1 independently justified row. Aggregate test/support delta **0**;
production prefixes before `#[cfg(test)]` are byte-identical. No independent
safety contract funds the added row, and no replacement declaration is added.

Actual isolated root-crate controls, using private copied sources/target:

| Broken behavior | Original | Keeper / restoration |
| --- | --- | --- |
| Omit the 512-candidate cap | Original test falsely passes on duplicate clocks. | The retained refusal fails with 513 valid clocks. Restoring the cap passes the frame tests, including the real published worker bridge. |
| Admit an oversized small-worker output budget | Removed assertion is redundant. | Retained envelope keeper fails its prelaunch-budget diagnostic; restored six worker tests pass. |
| Permit ordinary allocation zero | Original assembly test falsely passes. | New row fails the intended refusal; restored assembly test passes. |

The twelve changed-module declarations have fresh restored proof. The three
unchanged screen/transcript declarations passed in the preceding normal hook at
Hex head `8e83830f4` with identical relevant production/test inputs; this is reused
baseline evidence until the current normal hook runs, not a fresh candidate run.
Private receipts are `composition-{movie,worker,assembly}-proof-receipt.json` with
named logs under the campaign's disposable job. Controls never mutate the delivery
target. Evidence uses real local processes and synthetic video/files, not screen
capture, GUI, model inference, macOS or sealed-package acceptance.

On the integrated Linux main baseline `951090bb7`, all 43 Composition tests pass.
Removing the cap again makes the focused frame-clock test fail with the
simplified fixture. The assembly and worker test changes match the original
controls byte for byte. Hosted checks and merge remain pending.
The existing descendant deadline fixture still relies on OS
scheduling and a delayed-write observation; no new claim of deterministic
scheduler readiness is made. No observed failure is hidden with a retry.
CLI/commands/issues, retention, Agent range and speech adapters remain pending
or separately audited by their owners; this slice does not complete Composition
or the repository campaign. Existing automatic publication is authorized; no
manual release is requested.
