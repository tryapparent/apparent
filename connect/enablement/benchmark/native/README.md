# Native public-copy replay

Build the Worker and Connect client package using the [benchmark setup](../README.md#ready-to-watch-and-first-playback). Use the matching Chromium. Build the ignored test adapter from the checkout that supplies the
native sender:

```sh
build=$(mktemp -d /tmp/apparent-dev-connect-native-XXXXXX)
cargo test --locked --release --lib --no-run \
  --manifest-path connect/client/Cargo.toml --target-dir "$build" \
  --message-format=json > "$build/cargo.jsonl"
sender=$(jq -r 'select(.reason == "compiler-artifact" and .profile.test and .executable).executable' "$build/cargo.jsonl")
results=$(mktemp -d /tmp/apparent-dev-connect-copy-XXXXXX)
cd connect/service
node ../enablement/benchmark/recipient.ts "$results" "$chromium" watch-traced "$sender"
```

The adapter uses the production `prepare_public_link` and `process_once`
entrypoints against the loopback Worker. It seeds a synthetic upload grant
and consent in an isolated config and uses the built client's renewal
policy for that grant. It records pending link issuance before starting the
queue explicitly. The queue must complete and verify the owner manifest.
The unauthenticated recipient verifies the ready manifest, then opens the
link and acknowledges an advancing Chromium frame. The replay checks
original bytes and confirms that revocation denies both manifest and media
access after the timed endpoint. Native receipts identify the sender binary
by SHA-256 and record loopback request and Worker dispatch/reply timestamps.
Retain the Cargo receipt with the replay to identify the sender source.

The native workload is `default-public-copy-native-sender-v2`. Version 1
used a precomputed fresh-grant decision. The native workloads and the
existing synthetic-sender score have separate calibration and receipt
histories. These local replays are diagnostics. They use synthetic consent,
a seeded grant and an explicit queue trigger. They exclude the Desktop
gesture, clipboard, live authorization, WAN and managed storage.
