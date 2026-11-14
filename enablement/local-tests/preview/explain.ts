import type {Command, selection} from '../run.ts';

/** Presentation of the actual execution plan; never a second selection policy. */
export function explainSelection(result: ReturnType<typeof selection>, plan: Command[]): string {
  return [
    'Verification preview (committed range only; uncommitted changes are not included)',
    `History: ${result.historyKnown ? 'known' : 'unknown'}; input proof: ${result.inputProofKnown ? 'known' : 'unproven — conservative coverage'}`,
    `Selected owners: ${result.selected.join(', ') || '(none)'}`,
    'Changed paths:', ...result.paths.map(path => `  ${path}`),
    'Selection reasons:', ...result.reasons.map(reason => `  ${reason}`),
    'Commands (not executed unless --run is supplied):',
    ...plan.map(command => `  [${command.cwd}] ${command.argv.map(arg => JSON.stringify(arg)).join(' ')}`),
    'This plan does not establish native acceptance, permission state or publication.',
  ].join('\n');
}
