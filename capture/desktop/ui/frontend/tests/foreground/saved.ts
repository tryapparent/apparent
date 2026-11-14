/** Keep slow setup/proof outside the product's transient saved-control window. */
export async function savedForeground<P, S, R>(input: {
  prepareRecording: () => Promise<P>;
  stop: () => Promise<S>;
  interact: (saved: S, prepared: P) => Promise<R>;
  retain: (saved: S) => Promise<void>;
  reportRetentionFailure: (error: unknown) => void;
}): Promise<R> {
  const prepared = await input.prepareRecording();
  const saved = await input.stop();
  let failed = false;
  try { return await input.interact(saved, prepared); }
  catch (error) { failed = true; throw error; }
  finally {
    try { await input.retain(saved); }
    catch (error) {
      if (!failed) throw error;
      input.reportRetentionFailure(error);
    }
  }
}
