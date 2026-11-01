// The appcast has no Apparent release yet. A new signed release enables the Mac link.
import appcast from "../public/appcast.xml?raw"
import { latestRelease } from "./appcast"

export const RELEASE = latestRelease(appcast)
export const MAC_DMG: string | null = RELEASE.version ? "/releases/Apparent-latest-arm64.dmg" : null
export const BREW = "brew install --cask tryapparent/tap/apparent"
export const SKILL = "bunx skills add tryapparent/apparent"

// Enable each platform only after its artifact has been published.
export const LINUX_DOWNLOAD: string | null = null
