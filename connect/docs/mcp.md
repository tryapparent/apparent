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
4. Once `approved`, start a download:

```sh
apparent-connect-mcp fetch --state /absolute/private/reader-state \
  --id 0123456789abcdef0123456789abcdef \
  --out /absolute/private/recording.apparent
```

Repeat tool-call/step exchanges until `ready`. Open the resulting contact sheet
and frames visually before interpreting the transcript. Pending or partial
transfer does not mean the agent has seen the recording.

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

Each read returns at most 16 KiB of recording ciphertext and consumes existing
storage-read budget. The endpoint verifies file/chunk hashes, sender signature,
origin/account/capture identity, recipient binding, age finality, asset paths and
references. Plaintext stays in a private stage until final authorization and
publication into an exclusively reserved new destination.

Both single-stream captures and the deployed preview's separate evidence/media
streams are supported, including `notes.json`. Group names are authenticated in
each stream's context. Both groups must come from the same approved sender and
pass complete integrity/reference checks before one ordinary bundle is published.
An evidence-ready pending upload is still preparing for this full-bundle reader.

The current format encrypts the complete bundle. Large recordings require many
calls; passing base64 through model context is costly. **Actual ChatGPT Work/Cowork file
delivery and practical recording-size performance remain unverified.** The host
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
encryption defaults and consent unchanged. No schema migration, new cloud
resource, directory listing or automatic public sharing is required.

The live beta has a separately deployed mounted gateway and analytics behavior.
Preserve its current assets, exact binding/secret profile, routes and cleanup
schedule when adding MCP. The repository's hosted deployment template names a
different Worker; it is not the live deployment profile. This feature does not
activate that continuous-deployment gate or replace the published gateway.
