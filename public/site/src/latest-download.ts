export type DownloadPlatform = "mac" | "linux-x86_64" | "linux-aarch64" | "windows" | "unsupported"

type Asset = { name: string; browser_download_url: string }
export type GithubRelease = { draft: boolean; published_at: string; assets: Asset[] }

export function selectLatestDownload(releases: GithubRelease[], platform: DownloadPlatform): string | null {
  const pattern = {
    mac: /^Apparent-(?:Preview-)?[\w.-]+-arm64\.dmg$/,
    "linux-x86_64": /^Apparent-[\w.-]+-linux-x86_64\.AppImage$/,
    "linux-aarch64": /^Apparent-[\w.-]+-linux-aarch64\.AppImage$/,
    windows: null,
    unsupported: null,
  }[platform]
  if (!pattern) return null
  for (const release of [...releases].filter((r) => !r.draft).sort((a, b) => b.published_at.localeCompare(a.published_at))) {
    const asset = release.assets.find(({ name, browser_download_url: url }) =>
      pattern.test(name) &&
      url.startsWith("https://github.com/tryapparent/apparent/releases/download/") &&
      url.endsWith(`/${name}`),
    )
    if (asset) return asset.browser_download_url
  }
  return null
}
