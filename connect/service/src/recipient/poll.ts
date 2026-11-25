// Pending pages keep their bounded checks independent of React hydration.
import policy from '#bend/pending-poll'

export function pollReady(root: HTMLElement) {
  const panel = root.querySelector<HTMLElement>('[data-share-poll]')
  if (!panel) return () => {}
  const output = panel.querySelector<HTMLElement>('[data-poll-status]')
  const progress = panel.querySelector<HTMLElement>('[data-upload-progress]')
  const url = new URL(panel.dataset.manifest || '', location.href)
  if (url.origin !== location.origin) return () => {}
  const deadline = Date.now() + policy.lifetime()
  let lastCheck = performance.now()
  let attempts = 0, stopped = false, inFlight = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function dispose() {
    stopped = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onForeground)
    window.removeEventListener('focus', onForeground)
  }

  function reload() {
    dispose()
    location.reload()
  }

  function schedule(foreground = false) {
    if (stopped || inFlight) return
    clearTimeout(timer)
    const remaining = Math.max(0, deadline - Date.now())
    if (!policy.can_poll(remaining, attempts)) {
      dispose()
      if (output) output.textContent = 'Automatic checks stopped. Reload later or ask the sender to check the upload.'
      return
    }
    const sinceLast = Math.floor(performance.now() - lastCheck)
    const wait = policy.wait_ms(remaining, sinceLast, attempts, document.visibilityState === 'visible', foreground)
    if (wait > 0) timer = setTimeout(() => schedule(foreground), wait)
    else void poll(remaining)
  }

  function onForeground() {
    schedule(true)
  }

  async function poll(remaining: number) {
    inFlight = true
    lastCheck = performance.now()
    attempts++
    try {
      const response = await fetch(url.href, { credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(Math.min(4500, remaining)) })
      if (stopped) return
      if ([404, 410].includes(response.status)) { reload(); return }
      if (response.ok) {
        const manifest = await response.json() as { status?: string; uploadedBytes?: number; totalBytes?: number }
        if (stopped) return
        if (['ready', 'paused', 'failed', 'expired', 'revoked', 'deleted'].includes(manifest.status || '')) { reload(); return }
        if (manifest.status === 'pending' && progress && Number.isSafeInteger(manifest.uploadedBytes) && Number.isSafeInteger(manifest.totalBytes) && manifest.uploadedBytes! >= 0 && manifest.uploadedBytes! <= manifest.totalBytes!) progress.textContent = `${manifest.uploadedBytes} of ${manifest.totalBytes} bytes uploaded.`
      }
    } catch { /* Never log capability URLs or captured content. */ }
    finally {
      inFlight = false
      schedule()
    }
  }

  document.addEventListener('visibilitychange', onForeground)
  window.addEventListener('focus', onForeground)
  schedule()
  return dispose
}
