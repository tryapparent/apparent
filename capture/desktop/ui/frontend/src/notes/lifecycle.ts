/** Producer ordering for one notes child. Rust still owns durable save receipts. */
export function createNotesLifecycle() {
  let ready = false, finishing = false, notified = false, finished = false;
  return {
    get ready() { return ready; },
    get finishing() { return finishing; },
    get finished() { return finished; },
    markReady() { ready = true; },
    requestFinish() { finishing = true; },
    takeFinishNotification() {
      if (!ready || !finishing || notified) return false;
      notified = true;
      return true;
    },
    acknowledgeFinish() {
      if (!notified || finished) return false;
      finished = true;
      return true;
    },
  };
}
