import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export const mcpRecovery = `If this agent workspace blocks direct HTTPS access, use Apparent's encrypted MCP relay. Reuse an installed Apparent connector, or ask the user to add https://app.tryapparent.com/connect/mcp in ChatGPT/Claude with No authentication / No sign in and select it in this conversation.
Use the separate offline apparent-connect-mcp reader to exchange sealed requests through that connector; do not retry the native fetch through the same blocked network. Setup: https://github.com/tryapparent/apparent/blob/main/connect/docs/mcp.md . If the reader is unavailable here, ask the user to provide it; older native CLIs do not include this command.
The user must still approve read access. A newly approved reader cannot decrypt an older capture unless it was encrypted for that reader; ask the sender for a fresh encrypted handoff if needed. Keep private keys and tokens private, and inspect the delivered images before interpreting the recording.`;

export const alternatives = `Connect access is limited to 20 admitted accounts. Google sign-in alone does not grant upload or read access; waitlisted accounts cannot approve devices. Existing admitted accounts keep access when all places are occupied.

${mcpRecovery}

Recording still works. Keep the complete local .apparent folder.
On the recording computer: apparent inspect '/absolute/path/capture.apparent'
On another computer: use an existing authorized SSH/SCP connection or another approved file-transfer route to copy the complete folder, then inspect the destination path:
  scp -r recording-host:'/absolute/path/capture.apparent' ./capture.apparent
  apparent inspect ./capture.apparent
Replace recording-host and the example path with the actual authorized host and bundle. SSH is optional. If no approved route exists, ask the person which computer/destination to authorize; do not enable remote access, change credentials or forward private captures without permission.

For a failed Connect upload, run apparent connect status on the recording computer to find its local bundle and error. Network failures may be retried with apparent connect retry; beta_required means account access is required, not another Google login. A remote agent cannot recover the original local path from a Connect ID alone. Ask the sender for the local handoff if necessary.
After a failed upload, copy/paste the capture again to obtain its local handoff. Previously pasted Connect IDs do not change. Pending uploads can still use Connect IDs; an ID is not proof of readiness.`;

export function fetchFailure(kind: unknown): string | null {
  if (kind === 'unavailable') return 'Capture unavailable (not_found). The sender may still be uploading, the capture may have expired or been deleted, or this account/API origin may not have access. Check apparent connect status and confirm the API origin and approved read account with the sender; ask the sender to check upload status or provide a fresh handoff. Retry with --wait 120 if upload is still in progress.';
  if (kind === 'authorization') return 'Capture read authorization failed. Run apparent connect login for the configured API origin and ask the user to approve its verification link/code, then retry inspection.';
  if (kind === 'server_configuration') return `Confirm the sender's HTTPS API origin before running apparent connect login --server <confirmed-https-origin> --scope read --no-browser. A missing or invalid server setting does not prove an egress block.\n${mcpRecovery}`;
  if (kind === 'transport') return `Direct Connect transfer failed; a network restriction, timeout, response limit or unexpected HTTP response may be responsible.\n${mcpRecovery}`;
  return null;
}

// Native code supplies only a current, consented, generation-checked queue record.
// Keep workflow eligibility here; unknown and terminal states use the local bundle.
export function handoffPointer(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const { id, status } = value as Record<string, unknown>;
  return typeof id === 'string' && id.length === 32 && /^[a-f0-9]{32}$/.test(id)
    && (status === 'pending' || status === 'ready')
    ? `apparent inspect ${id}\n` : null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const request = JSON.parse(line);
    process.stdout.write(`${JSON.stringify(request.operation === 'alternatives' ? alternatives : request.operation === 'fetchFailure' ? fetchFailure(request.kind) : handoffPointer(request.job))}\n`);
    break;
  }
  lines.close();
}
