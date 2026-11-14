/** Preserve the first failure while still attempting and reporting evidence work. */
export async function withRetainedEvidence<R>(work: () => Promise<R>, retain: () => Promise<void>, reportSecondary: (error: unknown) => void): Promise<R> {
  let failed = false;
  try { return await work(); }
  catch (error) { failed = true; throw error; }
  finally {
    try { await retain(); }
    catch (error) { if (!failed) throw error; reportSecondary(error); }
  }
}

/** Keep slow setup/proof outside the product's transient saved-control window. */
export async function savedForeground<P, S, R>(input: {
  waitForRecordingControls: () => Promise<void>;
  prepareRecording: () => Promise<P>;
  stop: () => Promise<S>;
  interact: (saved: S, prepared: P) => Promise<R>;
  retain: (saved: S) => Promise<void>;
  reportRetentionFailure: (error: unknown) => void;
}): Promise<R> {
  await input.waitForRecordingControls();
  const prepared = await input.prepareRecording();
  const saved = await input.stop();
  return withRetainedEvidence(() => input.interact(saved, prepared), () => input.retain(saved), input.reportRetentionFailure);
}
