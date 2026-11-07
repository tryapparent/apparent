import { constants, closeSync, fstatSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';

// Compatibility with the reviewed GUI producer: this exact binary emits this
// refusal before acquiring the GUI owner or starting native services. Neither
// text nor an exit status from an arbitrary future producer grants clearance.
const reviewedGui = '9768f559f97b10e40b3efa348c54f220a87242794529d3d4fce37ace1b1e18d0';
export function confirmsForeignOwner(input: { executableSha256: string; stderr: string;
  truncated: boolean; exitCode: number | null; signal: string | null; profileWorkAbsent: boolean }) {
  return input.executableSha256 === reviewedGui && !input.truncated && input.exitCode === 1
    && input.signal === null && input.profileWorkAbsent
    && input.stderr.split(/\r?\n/).filter(line => line === 'Error: native-host-only requires its own GUI owner').length === 1;
}

export class ForeignOwnerRefusal extends Error {
  constructor() { super('Another Apparent is running. Quit the other Apparent from its tray, then launch this version again. This instance started no native recording services.'); }
}
export function isPreOwnershipRefusal(error: unknown): boolean { return error instanceof ForeignOwnerRefusal; }

/** Private bounded error record; never serialize ChildProcess/env/retained handles. */
export function persistStartupFailure(profile: string, error: unknown): void {
  const fd = openSync(join(profile, 'startup-diagnostic.log'), constants.O_WRONLY | constants.O_APPEND
    | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.nlink !== 1
      || stat.size > 1024 * 1024) throw new Error('Private startup diagnostic unavailable');
    const messages: string[] = [];
    let current = error;
    for (let depth = 0; depth < 6 && current instanceof Error; depth++) {
      messages.push(current.message.slice(0, 2000)); current = current.cause;
    }
    writeSync(fd, JSON.stringify({ at: new Date().toISOString(), scope: 'startup-diagnostic-only', messages }) + '\n');
    fsyncSync(fd);
  } finally { closeSync(fd); }
}
