export const MAIN_FEED = 'https://github.com/tryapparent/apparent/releases/download/app-shell-main-feed/main.json';
export const RELEASE_PREFIX = 'https://github.com/tryapparent/apparent/releases/download/app-shell-main-';
export const SHA = /^[0-9a-f]{40}$/;
export type ReleaseIdentity = { schema: 1; channel: 'main'; target: 'linux-x64'; sourceSha: string };
export type MainFeed = ReleaseIdentity & { ancestors: string[]; image: { url: string; sha256: string; size: number } };
export type UpdateState = { channel: 'main'; running: string | null; available: string | null;
  phase: 'unsupported' | 'not-installed' | 'idle' | 'checking' | 'ready' | 'restarting' | 'error'; message: string };
export interface UpdatePort { read(): Promise<UpdateState>; check(): Promise<UpdateState>; restart(): Promise<void>; ready(): Promise<void> }
export function identity(value: unknown): ReleaseIdentity {
  const v = value as ReleaseIdentity;
  if (!v || v.schema !== 1 || v.channel !== 'main' || v.target !== 'linux-x64' || !SHA.test(v.sourceSha)) throw new Error('Invalid Main build identity');
  return v;
}
export function feed(value: unknown, current: string): MainFeed {
  const v = value as MainFeed;
  identity(v);
  if (!Array.isArray(v.ancestors) || !v.ancestors.length || v.ancestors.length > 50_000
    || v.ancestors.some(s => typeof s !== 'string' || !SHA.test(s))
    || new Set(v.ancestors).size !== v.ancestors.length || !v.ancestors.includes(current) || !v.ancestors.includes(v.sourceSha)) {
    throw new Error('Main feed is stale or diverges from this installation');
  }
  const name = `Apparent-Foundation-main-${v.sourceSha}-linux-x64.AppImage`;
  if (!v.image || v.image.url !== `${RELEASE_PREFIX}${v.sourceSha}/${name}` || !/^[a-f0-9]{64}$/.test(v.image.sha256)
    || !Number.isSafeInteger(v.image.size) || v.image.size < 1 || v.image.size > 1024 ** 3) throw new Error('Invalid Main image');
  return v;
}
