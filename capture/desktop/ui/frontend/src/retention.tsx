import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Button } from '@apparent/ui/button';
import {RetentionController, retentionFeedback, retentionForPreset, type RetentionOperation, type RetentionPolicy, type RetentionState, type RetentionResult, type UsageResult} from '@apparent/record-storage';
import {retentionPorts} from './storage/transport';
import { NativeSelect, NativeSelectOption } from '@apparent/ui/native-select';
import { Help } from './storage/help';
import { RefreshCw } from 'lucide-react';

function retentionLabel({mediaDays, bundleDays}: RetentionPolicy) {
  const duration = (days: number | null) => days === null ? 'forever' : `${days} ${days === 1 ? 'day' : 'days'}`;
  return `Media ${duration(mediaDays)} · capture ${duration(bundleDays)}`;
}

function problem(result: RetentionResult | UsageResult | undefined, operation?: RetentionOperation) {
  if (!result || result.status === 'connected' || result.status === 'cancelled') return '';
  const mutation = operation === 'save' || operation === 'reset';
  if (result.status === 'error') {
    if (result.code === 'outcome_unknown') return operation === 'reset'
      ? 'Reset is unconfirmed. Use Refresh to check the saved limits.'
      : 'Save is unconfirmed. Use Refresh to check the saved limits.';
    if (result.code === 'config_write_failed' && mutation) return `Could not ${operation} retention. Use Refresh to read the saved limits.`;
    if (result.code === 'conflict') return 'Storage changed during this request. Refresh before trying again.';
    if (result.code === 'usage_unavailable') return 'Folder usage is unavailable or the scan exceeded its limit. Refresh usage to try again.';
    if (mutation) return `Could not confirm the ${operation}. Use Refresh to check the saved limits.`;
    return 'Storage is unavailable. Refresh when the Rust app is responsive.';
  }
  if (result.status === 'incompatible') return 'This Rust backend does not support retention and usage yet.';
  if (result.status === 'disabled') return 'Experimental Storage is disabled in Rust.';
  return 'Not connected to Rust. Open Apparent and refresh.';
}

export function Retention({ effectivePath, settings = false }: { effectivePath: string; settings?: boolean }) {
  const [state, setState] = useState<RetentionState>({preset: '', busy: true, scanning: false});
  const [scannedAt, setScannedAt] = useState<string>();
  const controller = useRef<RetentionController | undefined>(undefined);
  const refresh = useRef<HTMLButtonElement>(null);
  const {result, usage, preset, busy, scanning, submission, operation} = state;
  const {phase, canReset} = retentionFeedback(state);
  const request = (operation: RetentionOperation) => controller.current?.request(operation);
  const commit = (operation: 'save' | 'reset', event: MouseEvent<HTMLButtonElement>) => {
    if (document.activeElement === event.currentTarget) refresh.current?.focus({preventScroll: true});
    void request(operation);
  };
  const measure = () => controller.current?.measure();
  useEffect(() => {
    const current = new RetentionController(retentionPorts, effectivePath);
    controller.current = current;
    const unsubscribe = current.subscribe(setState);
    void current.request('read');
    return () => { unsubscribe(); current.dispose(); if (controller.current === current) controller.current = undefined; };
  }, [effectivePath]);
  const snapshot = result?.status === 'connected' ? result : undefined;
  const issue = problem(result, operation);
  const showRefreshLabel = !!issue || phase === 'checking';
  const submittedLabel = submission && retentionLabel(submission.policy);
  useEffect(() => { if (usage?.status === 'connected') setScannedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })); }, [usage]);
  if (settings) return <div className="settings-retention">
    <section aria-labelledby="retention-label">
      <div className="settings-label"><h2 id="retention-label">Keep recordings</h2>
        <Help label="About keeping recordings">Media includes video, audio and full-size frames. The capture limit applies to the whole capture. Saving or resetting schedules cleanup, which waits until recording finishes.</Help>
        <Button ref={refresh} variant={showRefreshLabel ? 'secondary' : 'ghost'} size={showRefreshLabel ? 'default' : 'icon'}
          className={showRefreshLabel ? 'aria-disabled:cursor-wait' : 'settings-help aria-disabled:cursor-wait'}
          aria-label="Refresh retention" title="Refresh retention" aria-disabled={busy || scanning}
          onClick={() => { if (!busy && !scanning) void request('read'); }}>
          <RefreshCw aria-hidden="true" />{showRefreshLabel && 'Refresh'}
        </Button>
      </div>
      <p role="status">
        {phase === 'submitting' && `${submission?.operation === 'reset' ? 'Resetting' : 'Saving'}… ${submittedLabel}`}
        {phase === 'checking' && <span className="block">Checking saved limits…</span>}
        {(phase === 'checking' || phase === 'unconfirmed') && <span className="block">
          {submission?.operation === 'reset' ? 'Requested reset' : 'Requested save'} · {submittedLabel}
        </span>}
        {phase === 'idle' && busy && 'Reading saved retention…'}
      </p>
      {issue && <p role="alert">{issue}</p>}
      {snapshot && <>
        <NativeSelect aria-labelledby="retention-label" className="settings-policy" disabled={busy || scanning} value={preset}
          onChange={event => controller.current?.select(event.target.value)}>
          <NativeSelectOption value="" disabled>Custom policy (config file)</NativeSelectOption>
          {snapshot.retention.options.map(option => <NativeSelectOption key={option.id} value={option.id}>{retentionLabel(retentionForPreset(option.id))}</NativeSelectOption>)}
        </NativeSelect>
        {!snapshot.retention.preset && <p className="settings-metadata">Saved · {retentionLabel(snapshot.retention.effective)}</p>}
        <p id="retention-cleanup" className="mt-2 font-medium text-pretty">Shorter limits can move existing files to the Trash.</p>
        {snapshot.custom && <p id="retention-defaults">{snapshot.defaults
          ? `Reset to default · ${retentionLabel(snapshot.defaults)}`
          : 'Update Apparent to preview and reset the default limits.'}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button aria-describedby="retention-cleanup" disabled={busy || scanning || !preset || preset === snapshot.retention.preset} onClick={event => commit('save', event)}>Save retention</Button>
          <Button variant="secondary" aria-describedby={snapshot.custom ? 'retention-defaults retention-cleanup' : 'retention-cleanup'}
            disabled={busy || scanning || !canReset} onClick={event => commit('reset', event)}>Reset retention</Button>
          <span className="settings-metadata" role="status">{preset && preset !== snapshot.retention.preset ? 'Unsaved changes' : ''}</span>
        </div>
      </>}
    </section>
    <section className="settings-usage" aria-labelledby="usage-label">
      <div className="settings-label"><h2 id="usage-label">Capture-folder usage</h2><Help label="About capture-folder usage">Logical file size at the last scan, not free disk space. Refresh after background cleanup; no continuous scanning.</Help></div>
      <div className="settings-usage-row">
        <div role="status">{scanning ? <p>Calculating folder usage…</p> : usage?.status === 'connected' ? <>
          <strong>{usage.usage.formatted}</strong><p className="settings-metadata">Last scanned {scannedAt}</p>
        </> : !problem(usage) && <p className="settings-metadata">Not scanned yet</p>}</div>
        <Button variant="secondary" disabled={busy || scanning} onClick={() => void measure()}>Refresh usage</Button>
      </div>
      {problem(usage) && <p role="alert">{problem(usage)}</p>}
    </section>
  </div>;
  return <div className="space-y-4 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">Retention</h3>
      <Button variant="outline" disabled={busy || scanning} onClick={() => void request('read')}>Refresh retention</Button>
    </div>
    <div role="status" aria-live="polite" className="space-y-2 text-sm">
      {busy && <p>Waiting for retention…</p>}
      {issue && <p>{issue}</p>}
      {snapshot && <p>{snapshot.retention.note || 'Recordings and captures are kept forever.'}</p>}
    </div>
    {snapshot && <div className="flex flex-wrap items-end gap-3">
      <label className="grid gap-2 text-sm" htmlFor="retention-preset">Keep recordings
        <select id="retention-preset" className="h-9 rounded-md border border-border bg-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
          disabled={busy || scanning} value={preset} onChange={event => controller.current?.select(event.target.value)}>
          <option value="" disabled>Custom policy (config file)</option>
          {snapshot.retention.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      <Button disabled={busy || scanning || !preset || preset === snapshot.retention.preset} onClick={() => void request('save')}>Save retention</Button>
      <Button variant="outline" aria-describedby={snapshot.custom ? 'legacy-retention-defaults' : undefined}
        disabled={busy || scanning || !canReset} onClick={() => void request('reset')}>Reset retention</Button>
    </div>}
    {snapshot?.custom && <p id="legacy-retention-defaults" className="text-sm">{snapshot.defaults
      ? `Reset to default · ${retentionLabel(snapshot.defaults)}`
      : 'Update Apparent to preview and reset the default limits.'}</p>}
    <p className="text-sm text-muted-foreground">{settings
      ? 'Changes apply to cleanup shortly after saving. Cleanup waits until recording finishes. After changing the capture folder, restart Apparent so cleanup uses the new folder.'
      : 'Saving schedules the existing cleanup worker in about 5 seconds; it waits while recording. File edits apply on the next pass (normally hourly). A running worker keeps its startup folder until Apparent restarts. Saving does not move captures or run cleanup in this window.'}</p>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="font-semibold">Capture-folder usage</h3>
      <Button variant="outline" disabled={busy || scanning} onClick={() => void measure()}>Refresh usage</Button>
    </div>
    <div role="status" aria-live="polite" className="space-y-2 text-sm">
      {scanning && <p>Calculating folder usage…</p>}
      {problem(usage) && <p>{problem(usage)}</p>}
      {usage?.status === 'connected' && <><p className="font-medium">{usage.usage.formatted} in captures</p>
        <p className="break-all text-muted-foreground">{usage.usage.displayPath}</p></>}
    </div>
    <p className="text-sm text-muted-foreground">Logical file size at the last scan, not free disk space. Refresh after background cleanup; no continuous scanning.</p>
  </div>;
}
