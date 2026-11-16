import {isRetentionPolicy} from '../policy.js';
import type {RetentionPolicy} from '../types.js';

export interface RetentionFacts {
  ageMs: bigint;
  unchangedMs: bigint;
  source: string | null;
  capture: string | null;
  durationMs: bigint;
  videoBytes: bigint | null;
  heavyMedia: boolean;
}
export type RetentionAction = {index: number; kind: 'trashMedia' | 'trashBundle' | 'shrink'};
export type RetentionMode = 'pass' | 'shrinkOnly';
const U64_MAX = 0xffff_ffff_ffff_ffffn;
const DAY = 86_400_000n;

function unsigned(value: bigint) {
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) throw Error('Invalid retention observation');
}

/** Native observations only; no filesystem, mutation, renderer or config access. */
export function planRetention(
  policy: RetentionPolicy, observations: readonly RetentionFacts[], mode: RetentionMode = 'pass',
): RetentionAction[] {
  if (!isRetentionPolicy(policy) || !['pass','shrinkOnly'].includes(mode)) throw Error('Invalid retention request');
  const actions: RetentionAction[] = [];
  observations.forEach((facts,index) => {
    unsigned(facts.ageMs); unsigned(facts.unchangedMs); unsigned(facts.durationMs);
    if (facts.videoBytes !== null) unsigned(facts.videoBytes);
    const canShrink = () => {
      if (facts.source !== 'iphone' || facts.capture !== 'mirror' || facts.durationMs === 0n || facts.videoBytes === null) return false;
      const scaled = facts.videoBytes * 8000n;
      return (scaled > U64_MAX ? U64_MAX : scaled) / facts.durationMs > 6_000_000n;
    };
    const shrink = () => {if (canShrink()) actions.push({index,kind:'shrink'});};
    if (mode === 'shrinkOnly') {shrink();return;}
    const settled = (elapsed: bigint) => facts.ageMs >= elapsed && facts.unchangedMs >= elapsed;
    if (!settled(600_000n)) return;
    if (!settled(DAY)) {shrink();return;}
    const due = (days: number | null) => days !== null && facts.ageMs >= BigInt(Math.max(1,days)) * DAY;
    if (due(policy.bundleDays)) {actions.push({index,kind:'trashBundle'});return;}
    if (due(policy.mediaDays)) {
      if (facts.heavyMedia) actions.push({index,kind:'trashMedia'});
      return;
    }
    shrink();
  });
  return actions;
}
