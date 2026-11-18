# Shared test cleanup ledger

## Hex local transcription API

Base: `3a60e5bbe6231cb346e5d165f86d0f21e3eee707`. Read all production in
`shared/hex.rs`, the real `try_hex`/fallback and audio callers, and the Settings
language consumer before evaluating the 13 test declarations. This audit covers
the Hex module; other Shared modules and those consumers' own suites remain
separate campaign work. Production bytes before `#[cfg(test)]` are unchanged.

| Original declaration | Decision and retained behavior |
| --- | --- |
| `discovery_needs_api_two_a_port_and_a_token` | Retain valid extended discovery, API 2/port/token requirements, malformed/missing JSON, newline rejection and independent debug/error credential redaction. |
| `missing_discovery_or_refused_connection_is_not_connected` | Fix fixture ownership: private TempDir, prove a real live HTTP server first, drop it, require worker/log release and actual connection refusal. Missing discovery remains independent. |
| `connect_checks_token_and_api_version` | Retain real bearer auth, health/model DTO extensions, wrong-credential redaction and old API refusal; use an owned private TempDir. |
| `models_must_be_installed_and_verified_and_default_order_wins` | Retain ready/preferred order, explicit nonpreferred selection, unready fallback, nonpreferred-only absence and empty inventory. |
| `language_is_sent_to_hex_without_injecting_query_parameters` | Keeper: real HTTP values for nl/auto/en, blank default, trimmed/case-normalized and future language; all invalid inputs refuse before any extra request. |
| `language_codes_allow_future_languages_but_not_url_syntax` | Consolidate into HTTP keeper: transfer all three positive and six invalid rows. Preserve its existing independent query-injection row too. |
| `busy_is_retried_and_other_refusals_are_not` | Fix permanent 409/400 rows to use the actual retrying caller and require exactly one request each. Consolidate repeated busy count/first-request/path checks into the complete three-request method/path/body-length trace; retain the response-driving atomic counter. |
| `spreading_tiles_the_span_by_word_length` | Retain exact source span, no gaps/overlap, length weighting, phrase text/boundary, empty and zero-span rows. |
| `chunk_wavs_preserve_every_pcm_sample_including_sub_ms_tail` | Retain actual WAV encode/decode sample equality through >60 seconds and fractional-millisecond tail. |
| `selection_preserves_quiet_gaps_short_words_and_final_tail` | Retain continuous coverage, bounded positive requests, final tail, silence and empty input. Distinct from encoded PCM equality. |
| `clip_transcripts_land_inside_their_clips_in_order` | Retain source/model/estimated facts, empty provider result, combined text, source clocks/order and phrase count. |
| `a_refused_clip_aborts_even_after_a_successful_prefix` | Retain late rejection of the whole attempt rather than publishing its successful prefix, plus busy failure. |
| `transcribe_audio_sends_continuous_audio_to_the_fake_hex` | Retain real decode/plan/encode/HTTP composition, complete WAV size and source-clock first/last word. |

The external loopback HTTP server remains useful; it is not replaced with an
internal mock. Its old detached thread retained the listener and request log
until process exit. `Fake` now owns its thread and a listener clone, signals
shutdown, wakes its own still-reserved address, and joins. Keeping the listener
through join prevents a panic from making shutdown target a reused port. Socket
reads/writes are bounded; normal teardown adds no sleep/poll loop. A worker panic
fails the test, while teardown during an existing unwind avoids a second panic.
The actual refused-connection keeper observes the log's weak ownership and the
closed network boundary before test-local resources can conceal a survivor.

### Cost and sensitivity

13 → 12 declarations; test/support **-2 lines**, production **0**. Both fixed PID
directories and manual removal disappear. The language parser donor is deleted
only after all its independent rows reach the stronger HTTP keeper. The small
fixture lifetime guard repairs a demonstrated leak; no unrelated safety
contract funds the added teardown ownership. No replacement declaration, retry
or production-only testing seam is introduced.

Fresh isolated root-crate proof uses actual production, real loopback HTTP and
synthetic PCM. All 12 retained tests pass before controls and after exact source
restoration. The previous normal hook at Agent head `4ff82285e` ran all original
13 cases successfully with identical Hex input bytes; that is reused baseline
evidence, not a new run of this candidate.

| Control | Observed result |
| --- | --- |
| Original fixture with the keeper's live/drop/weak guard | Fails `fake server worker outlived its owner`. |
| Retry `Unavailable` failures | Original retry test stays green; keeper fails `HTTP 409 must not be retried`. |
| Retry `Rejected` failures | Original retry test stays green; keeper fails `HTTP 400 must not be retried`. |
| Change blank-language default to de | HTTP keeper fails the exact request-path trace. |
| Permit a query marker in language validation | HTTP keeper fails the intended `nl?` refusal. |
| Restore production exactly | All 12 retained cases pass. |

An additional private standard-library probe compiles the exact extracted test
fixture and observes worker/log release plus real port refusal after five
paths: idle ownership, successful HTTP, test-body unwind, provider panic, and
provider panic during a test-body unwind. All five pass; expected panics remain
failures rather than being swallowed. This is Linux fixture-lifetime evidence,
not production resource-lifecycle or macOS acceptance.

Private receipts under the campaign's disposable job:
`hex-contract-proof-receipt.json`, `hex-fixture-lifetime-receipt.json` and their
named logs. Initial reviewed source SHA-256:
`7083caa34b52aae59e9f001ff6f290589eee68b7a76551f59cccdc4fc1339afa`.
The private crate/target are distinct from the delivery target. No real Hex
service, credentials, model inference, OS audio, screen capture or UI was used.

Independent preservation review approved the three-file candidate at staged
diff SHA-256 `be3549de1f8085ab5882e3bd792727a1b952838c11978e7293eedf906b06137d`,
with no unstaged delta. It verified production identity, 13 → 12 declarations
and transfer of independent contracts, without rerunning heavy checks.
Its minor suggestion is repaired afterward: an unexpected fixture accept error
now propagates through the joined worker rather than silently ending service.
An injected external iterator error is surfaced; reverting that one handler
fails the control. All five lifetime paths and all 12 retained tests pass again.
This one-line follow-up leaves production and prior contract controls unchanged.
Final source SHA-256:
`2936299803ae65251d332125f3a5b9d73e8fe5e48f59e2c3da1ec745e2c22f15`;
receipt `hex-review-followup-receipt.json` records the exact follow-up.

Integrated main `d9b3af9d9b16d6c6b6e3651ceb300c1c01bc33cb` before publication.
Its Public runtime-cache verifier changes do not modify Hex, its callers or
Cargo inputs, so the exact Hex proof remains applicable. The incoming Public
test is inventoried as pending owner audit; the normal hook must verify the
combined tree, including that updated verifier.

### Remaining gates and risks

The normal push checks, hosted Linux/macOS verification,
merge and exact-landed CI remain required. The closed-port refusal shares the
preexisting OS ephemeral-port reuse race; no claim is made that this audit
eliminates it. The shutdown wake itself is protected by its still-owned listener.
This audit leaves production retry/backoff/deadline policy unchanged. Automatic
CI publication is authorized; no manual release is requested.
