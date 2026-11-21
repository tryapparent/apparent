import {readFileSync, lstatSync} from 'node:fs';
import {isAbsolute} from 'node:path';

export type Config = {
  support?: { executable: string; tokenFile: string; keyFile: string; agentUid: number };
  projectId: number; t3ProjectId: string; t3Origin: string; t3TokenFile: string;
  webhookTokenFile: string; stateDirectory: string; posthogCommand: string;
  posthogOrigin: string; port: number; dailyLimit: number; queueLimit: number;
  modelSelection: {instanceId: string; model: string; options?: {id: string; value: string}[]};
  runtimeMode: 'auto-accept-edits' | 'auto' | 'full-access';
};
export function secret(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
    throw Error('Secret must be a private, owned regular file');
  const value = readFileSync(path, 'utf8').trim();
  if (value.length < 32 || value.length > 4096 || /\s/.test(value)) throw Error('Invalid secret');
  return value;
}
export function config(env: NodeJS.ProcessEnv): Config {
  const required = (key: string) => {const value = env[key]?.trim(); if (!value) throw Error(`Missing ${key}`); return value;};
  const integer = (key: string, fallback: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw Error(`Invalid ${key}`);
    return value;
  };
  const path = (key: string) => {const value = required(key); if (!isAbsolute(value)) throw Error(`${key} must be absolute`); return value;};
  const t3Origin = new URL(required('T3_ORIGIN'));
  if (t3Origin.username || t3Origin.password || t3Origin.pathname !== '/' || t3Origin.search || t3Origin.hash ||
      !(t3Origin.protocol === 'https:' || t3Origin.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(t3Origin.hostname)))
    throw Error('T3_ORIGIN must be HTTPS or loopback HTTP, without credentials or a path');
  const posthogOrigin = env.POSTHOG_ORIGIN ?? 'https://eu.posthog.com';
  if (!['https://eu.posthog.com', 'https://us.posthog.com'].includes(posthogOrigin)) throw Error('Unsupported PostHog origin');
  const runtimeMode = env.T3_RUNTIME_MODE ?? 'full-access';
  if (!['auto-accept-edits', 'auto', 'full-access'].includes(runtimeMode)) throw Error('Unsupported runtime mode');
  const instanceId = required('T3_PROVIDER_INSTANCE');
  const reasoning = env.T3_REASONING_EFFORT ?? (instanceId === 'codex' ? 'high' : undefined);
  if (reasoning !== undefined && (instanceId !== 'codex' || !['low','medium','high','xhigh','max','ultra'].includes(reasoning)))
    throw Error('Unsupported Codex reasoning effort');
  const supportKeys = ['SUPPORT_REPORT_EXECUTABLE', 'SUPPORT_REPORT_TOKEN_FILE', 'SUPPORT_REPORT_KEY_FILE', 'SUPPORT_REPORT_AGENT_UID'];
  const support = supportKeys.some(key => env[key]) ? {
    executable: path(supportKeys[0]), tokenFile: path(supportKeys[1]), keyFile: path(supportKeys[2]),
    agentUid: integer(supportKeys[3], 0, 2147483647),
  } : undefined;
  if (support && (!process.getuid?.() || support.agentUid === process.getuid()))
    throw Error('The support reader and its coding agent require separate non-root accounts');
  return {support, projectId: integer('POSTHOG_PROJECT_ID', 329943, 2147483647), t3ProjectId: required('T3_PROJECT_ID'),
    t3Origin: t3Origin.origin, posthogOrigin, t3TokenFile: path('T3_TOKEN_FILE'), webhookTokenFile: path('WEBHOOK_TOKEN_FILE'),
    stateDirectory: path('STATE_DIRECTORY'), posthogCommand: path('POSTHOG_COMMAND'),
    port: integer('PORT', 8646, 65535), dailyLimit: integer('DAILY_LIMIT', 10, 100), queueLimit: integer('QUEUE_LIMIT', 100, 1000),
    modelSelection: {instanceId, model: required('T3_MODEL'),
      ...(reasoning === undefined ? {} : {options: [{id:'reasoningEffort', value:reasoning}]})},
    runtimeMode: runtimeMode as Config['runtimeMode']};
}
