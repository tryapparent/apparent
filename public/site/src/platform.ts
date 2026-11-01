import { useEffect, useLayoutEffect, useState } from "react"

export type Platform =
  | { kind: "mac"; macos?: number; architecture?: "arm" }
  | { kind: "mac-intel" }
  | { kind: "windows" }
  | { kind: "linux"; architecture?: "x86_64" | "aarch64" }
  | { kind: "mobile" }
  | { kind: "other" }

type UAData = {
  platform?: string
  mobile?: boolean
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string; platformVersion?: string }>
}

const KINDS = ["mac", "mac-intel", "windows", "linux", "mobile", "other"] as const

function uaData(): UAData | undefined {
  return (navigator as Navigator & { userAgentData?: UAData }).userAgentData
}

// Safari reports "Apple GPU" on every Mac, so it can't tell; Firefox and
// Chromium name the chip ("Apple M2", "Intel Iris", "AMD Radeon").
function macChip(): "arm" | "intel" | null {
  try {
    const gl = document.createElement("canvas").getContext("webgl")
    if (!gl) return null
    const read = (param: number) => String(gl.getParameter(param) ?? "")
    let renderer = read(gl.RENDERER)
    if (!/Apple M\d|Intel|AMD|Radeon|NVIDIA|GeForce/i.test(renderer)) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info")
      if (ext) renderer = read(ext.UNMASKED_RENDERER_WEBGL)
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext()
    if (/Apple M\d/.test(renderer)) return "arm"
    if (/Intel|AMD|Radeon|NVIDIA|GeForce/i.test(renderer)) return "intel"
  } catch {}
  return null
}

function override(): Platform | null {
  const value = new URLSearchParams(location.search).get("platform")
  return KINDS.find((k) => k === value) ? ({ kind: value } as Platform) : null
}

export function desktopOS(ua: string, hint: string): "mac" | "windows" | "linux" | "other" {
  // ChromeOS can have Linux-like architecture hints, but cannot run our AppImage.
  if (/CrOS/i.test(ua) || hint === "Chrome OS") return "other"
  if (/Windows/.test(ua) || hint === "Windows") return "windows"
  if (/Mac OS X|Macintosh/.test(ua) || hint === "macOS") return "mac"
  if (/Linux/.test(ua) || hint === "Linux") return "linux"
  return "other"
}

export function linuxArchitecture(ua: string, architecture?: string, bitness?: string): "x86_64" | "aarch64" | undefined {
  if (bitness && bitness !== "64") return undefined
  if (architecture) {
    if (bitness !== "64") return undefined
    if (architecture === "arm") return "aarch64"
    if (architecture === "x86") return "x86_64"
    return undefined
  }
  if (/aarch64|arm64/i.test(ua)) return "aarch64"
  if (/x86_64|x86-64|amd64/i.test(ua)) return "x86_64"
  return undefined
}

// Synchronous, so the first paint already shows the right button.
function guess(): Platform {
  const forced = override()
  if (forced) return forced
  const ua = navigator.userAgent
  const hint = uaData()?.platform ?? ""
  if (/iPhone|iPod|iPad|Android/.test(ua) || uaData()?.mobile || hint === "Android") return { kind: "mobile" }
  // iPadOS Safari asks for the desktop site with a Mac user agent.
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return { kind: "mobile" }
  const os = desktopOS(ua, hint)
  if (os === "windows" || os === "other") return { kind: os }
  if (os === "mac") {
    const chip = macChip()
    return chip === "intel" ? { kind: "mac-intel" } : { kind: "mac", ...(chip === "arm" && { architecture: "arm" as const }) }
  }
  return { kind: "linux", architecture: linuxArchitecture(ua) }
}

// Chromium can say exactly which chip and which macOS this is. Every Mac user
// agent string claims "Intel Mac OS X 10_15_7", so never infer chip from it.
async function refine(p: Platform): Promise<Platform> {
  const data = uaData()
  if (!data?.getHighEntropyValues || override() || (p.kind !== "mac" && p.kind !== "mac-intel" && p.kind !== "linux")) return p
  try {
    const { architecture, bitness, platformVersion } = await data.getHighEntropyValues(["architecture", "bitness", "platformVersion"])
    if (p.kind === "linux") {
      if (architecture || bitness) return { kind: "linux", architecture: linuxArchitecture(navigator.userAgent, architecture, bitness) }
      return p
    }
    if (architecture === "x86") return { kind: "mac-intel" }
    const macos = parseInt(platformVersion ?? "", 10)
    if (architecture === "arm" || p.kind === "mac") return {
      kind: "mac",
      ...(architecture === "arm" || p.kind === "mac" && p.architecture === "arm" ? { architecture: "arm" as const } : {}),
      ...(Number.isFinite(macos) ? { macos } : {}),
    }
  } catch {}
  return p
}

let first: Platform | undefined
let refined: Promise<Platform> | undefined

// The prerendered HTML shows the Mac download; the visitor's own platform
// replaces it before the first paint after hydration.
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>({ kind: "mac" })
  useLayoutEffect(() => {
    const p = (first ??= guess())
    setPlatform((prev) => (JSON.stringify(prev) === JSON.stringify(p) ? prev : p))
  }, [])
  useEffect(() => {
    let live = true
    ;(refined ??= refine(first ??= guess())).then((p) => {
      if (live) setPlatform((prev) => (JSON.stringify(prev) === JSON.stringify(p) ? prev : p))
    })
    return () => {
      live = false
    }
  }, [])
  return platform
}
