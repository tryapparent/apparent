// Desktop owns which trials are exposed. Native persists only this allowlist.
export type LabsSetting = 'streaming' | 'autoPaste' | 'pushToTalk' | 'sharing' | 'wisprFlow' | 'dictationFrog' | 'silentPrompt' | 'agentContext' | 'pillDoodles' | 'circleLabels';
type AgentContextAccess = 'enabled' | 'approval_required' | 'disabled' | 'unavailable';
type Preferences = {
  saved: boolean | null;
  circleLabelsSaved?: boolean | null;
  agentContextSaved?: boolean | null;
  agentContextAccess?: AgentContextAccess;
  sharingSaved?: boolean | null;
  autoPasteSaved?: boolean | null;
  autoPasteSupported?: boolean;
  pushToTalkSaved?: boolean | null;
  pushToTalkSupported?: boolean;
  wisprSaved?: boolean | null;
  wisprSupported?: boolean;
  dictationFrogSaved?: boolean | null;
  silentPromptSaved?: boolean | null;
  pillDoodlesSaved?: boolean | null;
  error?: never;
};
export type LabsFacts = Preferences | {
  error: 'config_read_failed' | 'config_write_failed';
  circleLabelsSaved?: never;
  agentContextSaved?: never;
  agentContextAccess?: never;
  pillDoodlesSaved?: never;
  pushToTalkSaved?: never;
  pushToTalkSupported?: never;
  saved?: never; sharingSaved?: never; autoPasteSaved?: never; autoPasteSupported?: never; wisprSaved?: never; wisprSupported?: never; dictationFrogSaved?: never; silentPromptSaved?: never;
};
const savedFlag = (value: unknown): value is boolean | null => value === null || typeof value === 'boolean';
export function facts(value: unknown): LabsFacts {
  if (!value || typeof value !== 'object') throw Error('Invalid Labs reply');
  const input = value as Record<string, unknown>;
  if (input.error === 'config_read_failed' || input.error === 'config_write_failed') return {error: input.error};
  if (!savedFlag(input.saved)) throw Error('Invalid Labs preference');
  const result: Preferences = {saved: input.saved};
  const access = input.agentContextAccess;
  if (access === 'enabled' || access === 'approval_required' || access === 'disabled' || access === 'unavailable') result.agentContextAccess = access;
  for (const key of ['autoPasteSaved', 'pushToTalkSaved', 'sharingSaved', 'wisprSaved', 'dictationFrogSaved', 'silentPromptSaved', 'agentContextSaved', 'circleLabelsSaved', 'pillDoodlesSaved'] as const) {
    if (input[key] === undefined) continue;
    if (!savedFlag(input[key])) throw Error('Invalid Labs preference');
    result[key] = input[key];
  }
  for (const key of ['autoPasteSupported', 'pushToTalkSupported', 'wisprSupported'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw Error('Invalid Labs capability');
    result[key] = input[key];
  }
  return result;
}
export function enabled(value: LabsFacts): boolean | undefined {return value.error ? undefined : value.saved ?? false;}
export function autoPasteEnabled(value: LabsFacts): boolean | undefined {return value.error ? undefined : value.autoPasteSaved ?? false;}
export function sharingEnabled(value: LabsFacts): boolean | undefined {return value.error ? undefined : value.sharingSaved ?? false;}
export function wisprEnabled(value: LabsFacts): boolean | undefined {return value.error ? undefined : value.wisprSaved ?? false;}
export class LabsPreferences {
  private reading?: Promise<LabsFacts>;
  private next = 0;
  private pending?: {id: number; resolve: (value: LabsFacts) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>};
  private send: (value: object) => void;
  constructor(send: (value: object) => void) {this.send = send;}
  request(value?: unknown, setting: LabsSetting = 'streaming'): Promise<LabsFacts> {
    if (value === undefined && setting === 'streaming')
      return this.reading ??= this.sendRequest(value, setting).finally(() => {this.reading = undefined;});
    return this.sendRequest(value, setting);
  }
  private sendRequest(value: unknown, setting: LabsSetting): Promise<LabsFacts> {
    if (value !== undefined && typeof value !== 'boolean' || !['streaming','autoPaste','pushToTalk','sharing','wisprFlow','dictationFrog','silentPrompt','agentContext','circleLabels','pillDoodles'].includes(setting) || this.pending) return Promise.reject(Error('Invalid or pending Labs request'));
    const request = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.pending = undefined; reject(Error('Labs acknowledgement timed out'));}, 3500);
      this.pending = {id: request, resolve, reject, timer};
      try {this.send({action: 'labs-preference', request, ...(value === undefined ? {} : {enabled: value}),...(setting === 'streaming' ? {} : {setting})});}
      catch {this.close();}
    });
  }
  receive(value: {request?: unknown; facts?: unknown}) {
    if (!this.pending || value.request !== this.pending.id) return;
    const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer);
    try {pending.resolve(facts(value.facts));} catch {pending.reject(Error('Invalid Labs reply'));}
  }
  close() {if (this.pending) {clearTimeout(this.pending.timer); this.pending.reject(Error('Settings closed')); this.pending = undefined;}}
}
