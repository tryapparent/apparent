// Fixture-only recovery before a native picker has opened. Callers must prove
// the rendered app_busy response; unknown/timeout outcomes throw, never retry.
export async function openNativePicker<T>(steps: {
  refresh: () => Promise<'ready' | 'busy'>;
  change: () => Promise<void>;
  observe: () => Promise<{ busy: true } | { picker: T }>;
}): Promise<{ picker: T; attempts: number }> {
  for (let attempts = 1; attempts <= 3; attempts++) {
    if (await steps.refresh() === 'busy') continue;
    await steps.change();
    const result = await steps.observe();
    if ('picker' in result) return { picker: result.picker, attempts };
  }
  throw new Error('Native picker preflight remained app_busy after three attempts');
}
