import { useEffect, useRef, useState } from "react"
import * as api from "./api"

export function SharedLinks() {
  const [session, setSession] = useState<api.Session | null>(null)
  const [rows, setRows] = useState<api.Share[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const generation = useRef(0)
  const guard = useRef(false)
  async function load() {
    const current = ++generation.current
    setLoading(true); setRows([]); setSession(null); setError("")
    try {
      const account = await api.session()
      if (current !== generation.current) return
      setSession(account)
      if (account.authenticated) {
        const next = await api.shares()
        if (current === generation.current) setRows(next)
      }
    } catch { if (current === generation.current) setError("Shared links could not be loaded. Reload to check your session and connection.") }
    finally { if (current === generation.current) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { generation.current++ } }, [])
  async function stop(row: api.Share) {
    if (guard.current || !session?.authenticated) return
    const current = generation.current
    guard.current = true; setBusy(true); setError("")
    try {
      await api.stopSharing(session.csrfToken, row.id)
      // Remove links while checking the exact mutation target. A 200 alone is not proof.
      setRows([])
      const next = await api.shares()
      if (current !== generation.current) return
      if (next.some(value => value.id === row.id && !["revoked", "expired", "deleted"].includes(value.status))) throw new Error("Stop sharing could not be confirmed. Reload to check the link before relying on revocation.")
      setRows(next)
    } catch (e) { if (current === generation.current) setError(e instanceof Error ? e.message : "Stop sharing could not be confirmed. Reload and retry.") }
    finally { guard.current = false; if (current === generation.current) setBusy(false) }
  }
  return <div className="pond-page hosted-page">
    <header className="pond-nav"><a href="/" aria-label="Apparent home"><img src="/apparent-wordmark.svg" width="149" height="35" alt="apparent" /></a><a className="hosted-account-link" href="/connect/">Account</a></header>
    <main className="hosted-main">
      <p className="hosted-eyebrow">Apparent Connect · beta</p><h1>Manage shared links</h1>
      <p className="hosted-intro">Anyone with this link can view and download this capture.</p>
      <p>Stop sharing blocks future access without deleting your private recording. It cannot recall downloads or cached previews. Sharing again creates a fresh link.</p>
      <section className="hosted-panel" aria-label="Shared links" aria-busy={loading || busy}>
        {loading && <p role="status">Checking your account…</p>}
        {error && <div role="alert" className="hosted-error"><p>{error}</p><button disabled={busy || loading} onClick={() => void load()}>Reload shared links</button></div>}
        {!loading && session && !session.authenticated && <><h2>Sign in to continue</h2><p>Sign in to your Connect account, then open Manage shared links.</p><a className="hosted-primary" href={api.signInUrl(false, "")}>Continue with Google</a></>}
        {!loading && session?.authenticated && !error && <>
          <p className="hosted-quiet">Signed in as {session.user.email}</p>
          {rows.length === 0 && !busy && <p>No shared links.</p>}
          <ul className="hosted-shares">{rows.map(row => <li key={row.id}>
            <h2>{row.title || "Untitled recording"}</h2>
            <p>Created <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time><br />Expires <time dateTime={row.expiresAt}>{new Date(row.expiresAt).toLocaleString()}</time></p>
            <p>Status: {row.status}</p>
            <div className="hosted-share-actions">{row.url && <a href={row.url} rel="noreferrer" referrerPolicy="no-referrer">Open shared recording</a>}{!["revoked", "expired", "deleted"].includes(row.status) && <button className="hosted-primary" disabled={busy} onClick={() => void stop(row)}>{busy ? "Stopping…" : "Stop sharing"}</button>}</div>
          </li>)}</ul>
        </>}
      </section>
      <noscript><p>Enable JavaScript to manage shared links. Opening this page never changes sharing.</p></noscript>
    </main>
  </div>
}
