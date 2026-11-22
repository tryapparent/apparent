import {useEffect, useId, useRef, useState} from 'react';
import {Button} from '@apparent/ui/button';
import {Input} from '@apparent/ui/input';
import {parseStorageLimit, storageLimitWarn, type NativeRetentionResult, type UsageResult} from '@apparent/record-storage';
import './size-limit.css';

type LimitPorts = {
  read(): Promise<NativeRetentionResult>;
  save(maximumMb: number): Promise<NativeRetentionResult>;
  usage(): Promise<UsageResult>;
};

type Snapshot = Extract<NativeRetentionResult, {status: 'connected'}>;
const gbFormatter = new Intl.NumberFormat(undefined, {maximumFractionDigits: 3});
function formatGb(bytes: bigint): string {
  const gb = Number(bytes) / 1_000_000_000;
  return gb > 0 && gb < 0.001 ? '<0.001 GB' : `${gbFormatter.format(gb)} GB`;
}

export function StorageSizeLimit({effectivePath, ports}: {effectivePath: string; ports: LimitPorts}) {
  const id = useId();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [usage, setUsage] = useState<UsageResult>();
  const [draft, setDraft] = useState<string>();
  const [pending, setPending] = useState<'read' | 'save' | undefined>('read');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [attempt, setAttempt] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const live = useRef(false);
  const saving = useRef(false);

  useEffect(() => {
    live.current = true;
    return () => {live.current = false;};
  }, []);

  useEffect(() => {
    let current = true;
    setError('');
    setPending('read');
    async function load() {
      try {
        const result = await ports.read();
        if (!current) return;
        if (result.status === 'connected' && result.maximumMb !== undefined) {
          setSnapshot(result);
          setDraft(value => value !== undefined && parseStorageLimit(value) === result.maximumMb ? undefined : value);
        } else {
          setError('Could not read the saved limit. Try again.');
        }
      } catch {
        if (current) setError('Could not read the saved limit. Try again.');
      }
      if (!current) return;
      try {
        const result = await ports.usage();
        if (current) setUsage(result);
      } catch {
        if (current) setUsage({status:'error', code:'usage_unavailable'});
      } finally {
        if (current) setPending(undefined);
      }
    }
    setUsage(undefined);
    void load();
    return () => {current = false;};
  }, [ports, attempt]);

  useEffect(() => {if (feedback && !pending) field.current?.focus();}, [feedback, pending]);

  const saved = snapshot?.maximumMb ?? null;
  const next = draft === undefined ? undefined : parseStorageLimit(draft);
  const dirty = draft !== undefined && next !== saved;
  const invalid = draft !== undefined && next === undefined;
  const warn = dirty && next !== undefined && storageLimitWarn(saved, next);
  const description = [`${id}-help`, invalid ? `${id}-error` : '', warn ? `${id}-warning` : ''].filter(Boolean).join(' ');
  const value = usage?.status === 'connected' && usage.usage.effectivePath === effectivePath ? usage.usage.bytes : undefined;
  const used = value === undefined ? undefined : BigInt(value);
  const limit = saved && BigInt(saved) * 1_000_000n;
  const difference = used !== undefined && limit ? used - limit : undefined;
  const limitLabel = limit ? `${dirty ? 'saved ' : ''}${formatGb(limit)} limit` : '';
  const percentage = used !== undefined && limit ? Number(used > limit ? limit : used) / Number(limit) : undefined;

  async function save() {
    if (!snapshot || pending || saving.current || !dirty || next === undefined || error) return;
    saving.current = true;
    setPending('save');
    setFeedback('');
    try {
      const result = await ports.save(next);
      if (!live.current) return;
      if (result.status === 'connected' && result.maximumMb === next) {
        setSnapshot(result);
        setDraft(undefined);
        setFeedback(next === 0 ? 'Size limit removed.' : 'Storage limit saved.');

      } else {
        setError('Could not confirm the save. Check the saved limit before trying again.');
      }
    } catch {
      if (live.current) setError('Could not confirm the save. Check the saved limit before trying again.');
    } finally {
      saving.current = false;
      if (live.current) setPending(undefined);
    }
  }

  return <>
    <section className="storage-usage-overview" aria-labelledby={`${id}-usage`}>
      <h2 id={`${id}-usage`}>Space used by captures</h2>
      <div role="status">
        {used === undefined ? <p>{usage ? 'Could not measure folder usage.' : 'Calculating folder usage…'}</p> : <>
          <p className="storage-used">{formatGb(used)}</p>
          {percentage !== undefined && <meter min={0} max={1} value={percentage} aria-label="Share of saved storage limit used" />}
          {saved === 0 && <p className="storage-detail">No size limit</p>}
          {difference !== undefined && <p className="storage-detail">
            {difference > 0n ? <><strong>{formatGb(difference)} over</strong> the {limitLabel}</> :
              difference < 0n ? `${formatGb(-difference)} below the ${limitLabel}` : `At the ${limitLabel}`}
          </p>}
        </>}
      </div>
      {usage && used === undefined && !error && <Button type="button" variant="outline" onClick={() => setAttempt(attempt + 1)}>Retry usage scan</Button>}
    </section>
    <form className="storage-limit-form" noValidate onSubmit={event => {event.preventDefault(); void save();}}>
      <div className="storage-limit-label">
        <label htmlFor={id}>Maximum storage</label>
        <p className="storage-detail" id={`${id}-help`}>0 GB means no size limit.</p>
      </div>
      <div className="storage-limit-control">
        <div className="storage-limit-field">
          <Input id={id} ref={field} aria-label="Maximum storage in GB" aria-describedby={description}
            type="number" inputMode="decimal" min={0} step="any" placeholder="0"
            aria-invalid={invalid || undefined} disabled={!snapshot || !!pending || !!error}
            value={draft ?? (saved === null ? '' : String(saved / 1000))}
            onKeyDown={event => {
              if (event.key === 'Escape' && dirty) {event.stopPropagation(); setDraft(undefined);}
            }}
            onChange={event => {setFeedback(''); setDraft(event.target.value);}} />
          <span aria-hidden="true">GB</span>
        </div>
        {invalid && <p className="storage-detail" id={`${id}-error`} role="alert">{draft.startsWith('-') ? 'Use 0 GB or more.' : 'Enter up to three decimal places between 0 and 99,999.999 GB.'}</p>}
      </div>
      {snapshot && saved === null && <p className="storage-detail storage-limit-legacy">Age-based cleanup applies until you save a size limit.</p>}
      {(dirty || pending === 'save') && <div className="storage-limit-actions">
        {warn && <p className="storage-detail" id={`${id}-warning`}>Cleanup may move the oldest captures to the Trash to meet this limit.</p>}
        <Button type="submit" disabled={invalid || !!pending || !!error}>{pending === 'save' ? 'Saving…' : 'Save limit'}</Button>
      </div>}
      {error && <div className="storage-limit-actions"><p role="alert">{error}</p><Button type="button" variant="outline"
        onClick={() => {setAttempt(attempt + 1);}}>Check saved limit</Button></div>}
      <p className="storage-detail storage-limit-feedback" role="status">{feedback}</p>
    </form>
  </>;
}
