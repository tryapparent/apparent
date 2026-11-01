import { useState, type MouseEvent } from "react"
import { usePlatform } from "../../platform"
import { selectLatestDownload, type DownloadPlatform, type GithubRelease } from "../../latest-download"

const RELEASES = "https://github.com/tryapparent/apparent/releases"
const API = "https://api.github.com/repos/tryapparent/apparent/releases?per_page=100"

export function LatestDownload({ nav = false }: { nav?: boolean }) {
  const platform = usePlatform()
  const [busy, setBusy] = useState(false)
  const className = nav ? "nav-dl" : "btn-primary"

  if (platform.kind === "windows") return <span className={className} aria-disabled="true">Windows unsupported</span>
  if (platform.kind === "other") return <span className={className} aria-disabled="true">Platform unsupported</span>
  if (platform.kind === "mac-intel") return <span className={className} aria-disabled="true">Apple silicon only</span>
  if (platform.kind === "mobile") return <a className={className} href={RELEASES}>Get the desktop app</a>
  // Safari does not reveal the Mac chip, and some Linux browsers omit their
  // architecture. Let the visitor choose instead of downloading the wrong CPU.
  if (platform.kind === "mac" && platform.architecture !== "arm")
    return <a className={className} href={RELEASES}>Choose Mac download</a>
  if (platform.kind === "linux" && !platform.architecture)
    return <a className={className} href={RELEASES}>Choose Linux download</a>

  const linuxArm = platform.kind === "linux" && platform.architecture === "aarch64"
  const target: DownloadPlatform = platform.kind === "mac" ? "mac" : linuxArm ? "linux-aarch64" : "linux-x86_64"
  const label = nav ? `Get the app · ${platform.kind === "mac" ? "Mac" : "Linux"}` :
    `Download preview for ${platform.kind === "mac" ? "Mac" : linuxArm ? "Linux (ARM64)" : "Linux (x86_64)"}`

  async function download(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const response = await fetch(API, { headers: { Accept: "application/vnd.github+json" } })
      if (!response.ok) throw new Error("Release lookup failed")
      const releases: unknown = await response.json()
      if (!Array.isArray(releases)) throw new Error("Invalid release list")
      const url = selectLatestDownload(releases as GithubRelease[], target)
      if (!url) throw new Error("No installer for this platform")
      window.location.assign(url)
    } catch {
      // The link also works without JavaScript; on an API failure let visitors
      // choose a published asset rather than silently handing them the wrong OS.
      window.location.assign(RELEASES)
    } finally {
      setBusy(false)
    }
  }

  return <a className={className} href={RELEASES} onClick={download} data-download-platform={platform.kind} aria-busy={busy}>
    {busy ? "Finding download…" : label} {!nav && <span aria-hidden="true">↓</span>}
  </a>
}
