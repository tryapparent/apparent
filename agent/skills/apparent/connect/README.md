## A Connect capture on another computer

If direct HTTPS access is blocked in the agent workspace, check for an installed
Apparent MCP connector before asking only for image attachments. If it is missing,
give the user actionable setup instructions, not only a server URL. For ChatGPT:

1. Open [Plugins](https://chatgpt.com/plugins), select the plus button, then **Add custom MCP server**.
2. Enter **Name: Apparent** and **Server URL: `https://app.tryapparent.com/connect/mcp`**.
3. Choose **No authentication**, review the risk warning, then **Create as a plugin**.
4. Install Apparent, start a new Work conversation, and select Apparent using `@`. Continue there with the capture ID.

If custom MCP creation is unavailable under workspace policy, ask the workspace
administrator; do not bypass the policy. In Claude, use its custom connector setup
with the same server URL and **No sign in**.

After selection, handle reader setup and sealed exchanges yourself, present the
browser read-approval link to the user, and resume retrieval and visual inspection
after approval. Use the separate offline `apparent-connect-mcp` reader described
in `connect/docs/mcp.md`. Prefer its `inspect` command for images; grouped captures
need not download the movie first. On hosts with programmatic tool access, use
`run --mode inspection` and pipe complete tool replies into stdin, exposing only
progress/results to the model. Never transcribe ciphertext. Reuse the private
reader state after upgrading; do not generate a replacement key just to increase
transfer size. The `fetch` command still retrieves the complete recording.
Older native CLIs do not include this reader. Ask the
user for the reader if it is unavailable. Browser read approval remains required;
a new reader key does not unlock historical captures, so a fresh encrypted handoff
may be needed. Do not send private keys/tokens or bypass workspace network policy.
“Server must use HTTPS” instead indicates a missing/invalid receiving API setting:
confirm the sender's HTTPS origin before login, rather than treating that message
as proof of blocked egress. Inspect actual delivered images before interpreting
the recording.


For per-file encrypted v2 captures, run `apparent connect files <id>` to read the
authenticated asset index without downloading media. Retrieve transcript and
image evidence with `apparent fetch <id> --out ./capture-evidence --file apparent.json --file contact-sheet.png`;
repeat `--file` for relevant frame paths from the listing. Transcript data is in
`apparent.json`. The result is a marked extraction, not a complete `.apparent`
bundle: omitted video/audio/frames have not been downloaded or inspected. Request
video explicitly when the task requires watching it. The offline MCP reader
supports `list --state <dir> --id <id>` and the same repeated `fetch --file`
selection; follow `connect/docs/mcp.md`. A v1 capture or older CLI requires a full
fetch or an explicitly requested fresh sender upload; do not disable encryption
to obtain selective access. A pending upload still requires readiness before
retrieval. Open the actual downloaded images before interpreting visual evidence.

Connect admits 20 accounts; Google sign-in alone grants no device access. A waitlisted account cannot approve upload or read access. Do not repeatedly request login for `beta_required`. Recording and local inspection still work. Use `apparent connect alternatives` for recovery instructions (update older clients if absent).

A local path belongs to the recording computer. If the agent runs there, inspect that path directly. Otherwise, use an existing authorized SSH/SCP connection or another approved transfer route to copy the **complete** `.apparent` folder, including media and subdirectories, then inspect its destination path. For example, replace the host/path in `scp -r recording-host:'/absolute/path/capture.apparent' ./capture.apparent`, then run `apparent inspect ./capture.apparent`. SSH is optional; do not enable remote access, change credentials or forward private captures without permission. If no approved route exists, ask which computer/destination the person authorizes.

Failed/expired uploads use a local path when the sender copies the capture again; previously pasted IDs cannot change. Pending uploads retain Connect IDs without promising readiness. If an ID cannot be fetched, the sender can run `apparent connect status` on the recording computer to find the local original and error, then copy again or transfer the folder through an approved route. A remote agent cannot derive the local bundle path from an opaque ID. Never infer unseen images from the transcript.

A Connect paste starts with `apparent inspect <32-lowercase-hex-id>` (fetches to `./<id>.apparent`, waits up to 120 seconds, then prints the summary); older apps include a `Connect capture:` or `Hosted capture:` header. Reuse the receiving CLI's configured server and existing read grant. For a v2 capture, list and retrieve the evidence you need as described below. For older captures, fetch the complete bundle, then inspect it. The duration header and timestamped words/marks are last; the install fallback links to README’s Agents section, which owns the current installation guide. A local-only paste includes an `apparent inspect <absolute-path>` command. When the pasted timeline has the context you need, use that path to open the local images. Only when authorization is missing should a person approve a **separate read grant**. Update Apparent to use `apparent connect`; older apps use `apparent cloud`, which remains a compatibility alias in updated apps:

```sh
apparent connect login --server https://api.example.com --scope read --no-browser
apparent fetch <32hex-id> --out ./capture.apparent --wait 120
```

Normal prompts omit server/login instructions. A custom-origin capture requires the receiving CLI to be configured for that same origin separately; do not guess it from an opaque capture ID. The example origin above is a placeholder. Let the person approve the read scope at the printed verification URI; do not request or paste bearer tokens, reuse an upload token, or silently expose one through clipboard text. Read login does not enable uploads. `--out` must not exist and its parent must exist. Fetch waits for readiness, validates all allowed files and SHA-256 hashes, and atomically publishes the complete bundle; it never merges into existing output. `--wait` is pending polling time (0–900 seconds), not the full download deadline. If pending/offline/quota/auth fails, report that boundary and keep the local original; never infer image content from the ID alone. After successful fetch, open the sheet and frames visually before acting, as with a local bundle.

Uploader account/queue state is discoverable with `apparent connect status` (`--account` explicitly queries quota). Upload is default off behind `hostedSync` plus `cloud.enabled` and explicit `cloud.uploadConsent` in config.json. Only `apparent connect login --scope upload --consent-upload` opts in; do not do that merely to read a capture. `apparent connect disable` cancels pending uploads; `apparent connect logout` also removes local credentials. `apparent connect retry` retries eligible jobs under their existing IDs; it cannot revive cancelled or expired captures. Explicit `apparent connect upload <bundle>` queues a fresh ID on every invocation, including historical or changed bundles; do not use it as an ordinary retry. Updated clients renew approved device credentials automatically without changing the queued capture IDs or upload consent. Revoked or expired renewal requires device approval again; a network failure is not a reason to request new approval. Legacy credentials require an app update and one new login. Browser sign-in alone does not renew device access. Service login never adds trusted decryption keys. V1 rejects files above 90,000,000 bytes, never drops media to fit. See `connect/docs/hosted-client.md` for private credential artifacts, retry limits and complete-bundle restrictions.
