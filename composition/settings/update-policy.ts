export type UpdateIdentity = { channel: 'stable' | 'main'; id: string };
export interface UpdateFacts {
  candidate: UpdateIdentity;
  installed: UpdateIdentity | null;
  revision: string | null;
  modified: boolean;
}

// Discovery supplies an authenticated channel target; installed history is not
// an ordering authority. A fork, local build or newer version can converge too.
export function needsChannelRelease(facts: UpdateFacts): boolean {
  const {candidate, installed} = facts;
  if (!['stable', 'main'].includes(candidate.channel) || !candidate.id) throw Error('Invalid update target');
  if (installed) return installed.channel !== candidate.channel || installed.id !== candidate.id;
  // Freshly packaged Main already embeds its revision, before the first marker.
  return !(candidate.channel === 'main' && !facts.modified && candidate.id === facts.revision);
}

export const channelUpdateHint = 'Checking for updates installs the latest release in this channel, even if it is an earlier version.';
