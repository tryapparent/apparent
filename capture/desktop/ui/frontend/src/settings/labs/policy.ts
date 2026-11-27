// Desktop owns which trials are exposed. Native persists only this allowlist.
export type LabsSetting = 'streaming' | 'pushToTalk' | 'sharing' | 'wisprFlow' | 'dictationFrog' | 'desktopFrog' | 'frogWardrobe' | 'speakingStyle' | 'videoTracing' | 'recordingPerformance';
const savedFlags = ['pushToTalkSaved', 'sharingSaved', 'wisprSaved', 'dictationFrogSaved', 'desktopFrogSaved', 'speakingStyleSaved', 'videoTracingSaved', 'recordingPerformanceSaved'] as const;
type Preferences = Partial<Record<(typeof savedFlags)[number], boolean | null>> & {
  saved: boolean | null;
  pushToTalkSupported?: boolean;
  wisprSupported?: boolean;
  frogWardrobe?: unknown;
};
export type LabsFacts = (Preferences & {error?: never}) | ({
  [Key in keyof Preferences]?: never;
} & {error: 'config_read_failed' | 'config_write_failed'});
const savedFlag = (value: unknown): value is boolean | null => value === null || typeof value === 'boolean';
export function facts(value: unknown): LabsFacts {
  if (!value || typeof value !== 'object') throw Error('Invalid Labs reply');
  const input = value as Record<string, unknown>;
  if (input.error === 'config_read_failed' || input.error === 'config_write_failed') return {error: input.error};
  if (!savedFlag(input.saved)) throw Error('Invalid Labs preference');
  const result: Preferences = {saved: input.saved, ...(input.frogWardrobe == null ? {} : {frogWardrobe: input.frogWardrobe})};
  for (const key of savedFlags) {
    if (input[key] === undefined) continue;
    if (!savedFlag(input[key])) throw Error('Invalid Labs preference');
    result[key] = input[key];
  }
  for (const key of ['pushToTalkSupported', 'wisprSupported'] as const) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') throw Error('Invalid Labs capability');
    result[key] = input[key];
  }
  return result;
}
export function enabled(value: LabsFacts): boolean | undefined {return value.error ? undefined : value.saved ?? false;}
export function sharingEnabled(value: LabsFacts): boolean | undefined {return value.error ? undefined : value.sharingSaved ?? false;}
export function wisprEnabled(value: LabsFacts): boolean | undefined {return value.error ? undefined : value.wisprSaved ?? false;}
export class LabsPreferences {
  private reading?: Promise<LabsFacts>;
  private next = 0;
  private pending?: {id: number; resolve: (value: LabsFacts) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>};
  private send: (value: object) => void;
  constructor(send: (value: object) => void) {this.send = send;}
  request(value?: unknown, setting: LabsSetting = 'streaming', wardrobe?: unknown): Promise<LabsFacts> {
    if (value === undefined && setting === 'streaming' && wardrobe === undefined)
      return this.reading ??= this.sendRequest(value, setting).finally(() => {this.reading = undefined;});
    return this.sendRequest(value, setting, wardrobe);
  }
  private sendRequest(value: unknown, setting: LabsSetting, wardrobe?: unknown): Promise<LabsFacts> {
    if (value !== undefined && typeof value !== 'boolean' || !['streaming','pushToTalk','sharing','wisprFlow','dictationFrog','desktopFrog','frogWardrobe','speakingStyle','videoTracing','recordingPerformance'].includes(setting) || this.pending) return Promise.reject(Error('Invalid or pending Labs request'));
    const request = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {this.pending = undefined; reject(Error('Labs acknowledgement timed out'));}, 3500);
      this.pending = {id: request, resolve, reject, timer};
      try {this.send({action: 'labs-preference', request, ...(value === undefined ? {} : {enabled: value}),...(setting === 'streaming' ? {} : {setting}), ...(wardrobe === undefined ? {} : {wardrobe})});}
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
export function admitLabsRequest(pane: string | undefined, args: unknown[], platform: string): boolean {
  const [enabled, setting, intent] = args;
  if (pane !== 'labs' || setting === 'autoPaste') return false;
  if (args.length === 3) return enabled === undefined && setting === undefined && !!intent && typeof intent === 'object' && !Array.isArray(intent);
  return args.length <= 2 && (!args.length || typeof enabled === 'boolean') &&
    (platform === 'darwin' || setting !== 'wisprFlow');
}
