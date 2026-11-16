# Encrypted Connect MCP relay

Connect's `/mcp` endpoint relays existing read approval and encrypted capture
bytes to a local TypeScript endpoint. It cannot inspect frames, decrypt captures,
upload recordings or create public links. Endpoint encryption remains the default.
The recording computer must encrypt for an approved reader before transfer.

The Worker uses the official MCP SDK's stateless Streamable HTTP transport with
JSON responses. `connect_relay_open` opens a ten-minute transport channel;
`connect_relay` carries an opaque endpoint-generated request. Arguments/results
contain no endpoint private key or plaintext read token. Installing the connector
does not approve a reader: the existing browser read approval is still required.

## Setup

This source adds `apparent-connect-mcp` to `connect/client/typescript`; it does
not add a command to older native CLIs or publish an npm release. Requires Node
22.18+ on macOS or Linux. In that package, run `npm ci && npm run build`, then use
`node dist/mcp-cli.js` instead of `apparent-connect-mcp` below. A packed
installation supplies the executable. No Rust, Electron, recording permission or
direct server connection is needed by this endpoint.

After the exact Worker candidate is deployed, add its HTTPS `/mcp` URL as a
custom server in ChatGPT Work or a custom web connector in Claude.
In ChatGPT, open Plugins → plus → Add custom MCP server, select **No authentication**,
create/install the personal plugin, then select it in a new Work conversation.
See [OpenAI's setup guide](https://developers.openai.com/plugins/quickstart).
In Claude, choose **No sign in**. The existing Apparent
device read approval runs inside the encrypted channel, rather than exposing
native tokens to the connector or introducing a second OAuth implementation.
Organization connector policies still apply.

```sh
apparent-connect-mcp init --state /absolute/private/reader-state
```

The new state directory must not exist. Ancestors must be trusted, owned by the
user or root, and free of symlinks and untrusted write access; sticky `/tmp` is
allowed. Use canonical paths (Darwin's `/var` commonly aliases `/private/var`).
Granting macOS ACLs are rejected. Setup never repairs existing permissions or
overwrites keys. `--server` selects another exact HTTPS API origin; the default
is `https://hosted.tryapparent.com`.

The existing beta gateway exposes the connector at
`https://app.tryapparent.com/connect/mcp` after deployment, while retaining the
legacy hosted API profile for native recording encryption and read credentials.
The CLI's server value names that encryption profile; it makes no direct HTTP
request. This first gateway integration supports the native app's default hosted
profile. Captures encrypted under a custom `/connect` API-base profile still need
the existing native reader.

1. Call the printed `tool` with its exact `arguments` through the connector.
2. Save the **complete** MCP result as JSON in the workspace, then run:
   `apparent-connect-mcp step --state /absolute/private/reader-state --reply /absolute/reply.json`.
3. Continue with the returned tool call. On `approval_required`, open the
   verification URL and explicitly approve **read** access. Run
   `apparent-connect-mcp next --state /absolute/private/reader-state` to prepare
   polling. Honor any `retryAt`; do not spin on pending approval/upload state.
4. Once `approved`, request images first:

```sh
apparent-connect-mcp inspect --state /absolute/private/reader-state \
  --id 0123456789abcdef0123456789abcdef \
  --out /absolute/private/inspection
```

For grouped recordings this downloads and authenticates only the complete evidence
stream, including contact sheets, frames, notes and metadata. It can finish while
media is still uploading. `inspection_ready` explicitly reports whether media was
downloaded; an inspection directory without media is not a complete recording.
Image references, signatures, hashes, age FINAL/EOF and final read/sender approval
are still verified. Metadata is preserved, including references to omitted media.
An `inspection.json` marker also records the artifact type and whether it contains
the complete recording, so moving the directory does not lose that distinction.
Legacy single-stream captures require downloading their entire encrypted stream;
the reader reports this as `mediaDownloaded: true`. No old recording is rewritten.

Use `fetch` with a different new destination when a full movie is needed:

```sh
apparent-connect-mcp fetch --state /absolute/private/reader-state \
  --id 0123456789abcdef0123456789abcdef \
  --out /absolute/private/recording.apparent
```

Repeat tool-call/step exchanges until `ready`. Open the resulting contact sheet
and frames visually before interpreting the transcript. Pending or partial
transfer does not mean the agent has seen the recording.

### Programmatic host bridge

When the host supports calling MCP tools from code, use the reader's JSON-lines
interface instead of exposing each ciphertext reply to the model:

```sh
apparent-connect-mcp run --state /absolute/private/reader-state \
  --id 0123456789abcdef0123456789abcdef --out /absolute/private/inspection \
  --mode inspection
```

`run` prints a small JSON line containing a `tool`, opaque `arguments` and transfer
progress. The host calls that installed MCP tool and writes its **entire result**
as one JSON line to the reader's stdin. The reader prints the next call. Continue
until a terminal state such as `inspection_ready`, `ready`, `approval_required`,
`waiting` or `failed`; show the model only progress and terminal results, not the
encrypted payload. A host must preserve raw results without transcription or
truncation. The production-worker tests exercise this bridge with the real CLI
and recording-sized replies while Node networking APIs in the CLI are denied.

`run --state <directory>` resumes the pending operation and can also drive initial
read approval. Present `verificationUri` to the user, respect `retryAt`, and resume
after approval or the indicated wait. `--mode bundle` selects full recording
retrieval. The `step --reply` interface remains for hosts that save complete replies
to files. Neither interface grants permission to bypass a host's tool policy.

Credentials renew inside the channel; the endpoint opens another transport
channel when necessary. `cancel --state <directory>` removes its tracked
incomplete transfer/decryption stages while retaining keys and authorization.
`revoke --state <directory>` revokes this reader through the relay; cancel an
active transfer first. It does not revoke other devices or erase delivered
plaintext. Preserve the private state when diagnosing failure: a replacement
identity cannot automatically decrypt historical captures.
Waitlisted accounts are reported explicitly without issuing read credentials.

The writer owns only `<state>/endpoint.json` and its short-lived `endpoint.lock`,
not native credential files or config.json. Concurrent commands fail closed.
After a crash, verify no endpoint command is running before removing only a stale
lock. A crash between a chunk write and state publication may require `cancel`
and another download with the retained key. Existing output paths are never replaced.

## Security and limits

Only the age public descriptor enters read approval. Existing account-authorized
recipient/sender discovery remains authoritative. A new reader receives future
freshly staged captures; key registration does not regrant history. See the
[encryption trust boundary](hosted-encryption.md), including the account service's
authority to authorize recipients.

JOSE ECDH-ES/P-256 with A256GCM separately protects transport credentials from
tool-visible text. A service-secret sealed ticket holds the expiring transport
private key, never the recording's age key. Connect handles native tokens
internally as before. The agent host can access its workspace and the evidence
it decrypts; this does not isolate secrets from a hostile agent host.
Request IDs bind replies to the current local step, but are not a server replay
cache. Captured opaque requests can be replayed until their channel expires;
existing native polling limits, bounded refresh replay and grant revocation
semantics still apply. No upload or other non-idempotent product writes are relayed.

New readers negotiate ranges of up to 1 MiB of recording ciphertext per call;
requests without an explicit range length retain the original 16 KiB response for
old-reader compatibility. Old servers advertise no extension and remain usable at
their legacy bound. A reply expands to about 1.9 MiB after nested base64/JWE encoding;
the CLI's file and stdin readers have a matching bounded limit. Tool hosts must
support lossless persistence at that size; protocol support alone is insufficient.
Every read consumes the existing storage-read budget. The endpoint verifies file/chunk hashes, sender signature,
origin/account/capture identity, recipient binding, age finality, asset paths and
references. Plaintext stays in a private stage until final authorization and
publication into an exclusively reserved new destination.

Both single-stream captures and the deployed preview's separate evidence/media
streams are supported, including `notes.json`. Group names are authenticated in
each stream's context. Both groups must come from the same approved sender and
pass complete integrity/reference checks before one ordinary bundle is published.
An evidence-ready pending upload can be inspected without its media; full `fetch`
still waits for both streams and requires the same approved sender for both.

Legacy v1 single-stream recordings encrypt the complete bundle, so image-first
transfer for those recordings requires the grouped format. New v2 uploads instead
use independently encrypted files and support exact selection and inspection. The representative 33 MiB
Worker/CLI test asserts fewer than 43 calls for full retrieval and at most six for
small grouped evidence; these are local integration bounds, not host latency claims.
Passing ciphertext through model context is costly. **Actual updated ChatGPT
Work/Cowork delivery remains a separate live acceptance check.** The host
must persist complete sealed tool results into its execution workspace with
direct CLI egress blocked. MCP protocol support alone does not prove that works.
There is no plaintext fallback or service-readable copy if it fails.

## Verification and rollout

In `connect/service`, `npm test` covers the service/SDK boundary. `npm run
test:mcp` explicitly installs/builds the TypeScript endpoint and exercises the
real Worker, browser read approval, ciphertext transfer, local decryption,
malicious archive refusal and revocation. The repository service gate runs both.
In `connect/client/typescript`, `npm test` and `npm run typecheck` cover private
state, publication and a packed consumer with native build tools denied.
The explicit Rust interoperability lane also runs the streaming MCP parser
against production signed multipart output; see the client README.

Synthetic tests do not prove deployed Google approval, host compatibility or
macOS runtime behavior. Before production acceptance, verify the exact deployed
candidate in ChatGPT Work, real approval, byte-preserving delivery with CLI egress
blocked, visual inspection and revocation. Keep the native CLI path throughout.
ChatGPT Work is the initial human test target; a pass there does not establish
Cowork-specific file handling or rendering, which remains separately unverified.
Rollback removes the MCP route/package entrypoint and leaves stored formats,
encryption defaults and consent unchanged. The range/stdio transport extension
requires no schema migration or new cloud resource and adds no public sharing.
The separate v2 capture format requires migration `0011.sql`; see the encryption
contract for deployment order and retained v1 compatibility.

The mounted beta gateway is built from `connect/enablement/hosting` and automatically
published after affected main verification. Delivery preserves its binding/secret
profile, routes and cleanup schedule; the sealed browser assets and Worker version
are checked after publication. See the Connect delivery section in the CI guide.

### Selective v2 evidence

New v2 uploads support index-first listing and exact asset selection:

```
apparent-connect-mcp list --state /absolute/private/reader --id <capture-id>
apparent-connect-mcp fetch --state /absolute/private/reader --id <capture-id> --out /absolute/new/evidence --file apparent.json --file contact-sheet.png
```

Drive each sealed exchange with `step`/`next` as before. Listing ends in `listed`
with authenticated asset names/sizes/hashes; it transfers no asset bytes.
Selective fetch ends in `ready` with `extraction` and `completeBundle:false`,
without a `bundle` field. It requests only the encrypted index/envelope and the
chosen file objects, then rechecks sender authorization before publication.
Use `apparent.json` for transcript and request relevant images for visual proof.
A transcript alone is not image inspection. An extraction cannot use a
`.apparent` destination. Full fetch remains available without `--file`, and v1
single/grouped captures retain full-bundle compatibility. Newly enrolled readers
still cannot decrypt history encrypted before their enrollment.

V2 also supports `inspect` / `run --mode inspection`: these download all
authenticated non-media assets, validate visual references and publish an
`inspection_ready` directory with `inspection.json` and
`completeRecording:false`. To pipe only named v2 files without passing ciphertext
through model context, use `run --mode files --file apparent.json --file contact-sheet.png`
with the existing `--state`, `--id` and `--out` arguments. The legacy boolean
inspection API remains compatible; programmatic v2 callers may pass
`{selection:[...]}` or `{listOnly:true}` to `fetchEndpoint`. All paths retain
negotiated range bounds, sender checks, private stages and final authorization.
