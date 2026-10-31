/// <reference types="node" />
// Builds llms.txt, llms-full.txt and skill.md from the README, the agent skill
// and the appcast, so they change when those do. vite.config.ts emits them
// into dist and serves them in dev.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { latestRelease } from "../src/appcast.ts"

const SITE = "https://app.tryapparent.com"
const REPO = "https://github.com/tryapparent/apparent"
const RAW_SKILL = "https://raw.githubusercontent.com/tryapparent/apparent/main/skills/apparent/SKILL.md"

const repo = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8")

export function release() {
  return latestRelease(repo("site/public/appcast.xml"))
}

// Lines outside fenced code blocks, so a "# comment" in a shell block isn't a heading.
function mapProse(md: string, f: (line: string) => string): string {
  let fenced = false
  return md
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) fenced = !fenced
      return fenced || line.startsWith("```") ? line : f(line)
    })
    .join("\n")
}

function section(md: string, heading: string): string {
  const level = heading.match(/^#+/)![0].length
  const out: string[] = []
  let inside = false
  let fenced = false
  for (const line of md.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced
    const h = !fenced && line.match(/^(#+) /)
    if (h && inside && h[1].length <= level) break
    if (inside) out.push(line)
    if (line === heading) inside = true
  }
  if (!inside) throw new Error(`agent-files: no "${heading}" section`)
  return out.join("\n").trim()
}

const shift = (md: string, by: number) => mapProse(md, (l) => (/^#+ /.test(l) ? "#".repeat(by) + l : l))
const unfrontmatter = (md: string) => md.replace(/^---\n[\s\S]*?\n---\n+/, "")

// One line per subcommand in the skill's shell examples. A command the map
// doesn't know yet falls back to its own comment in the skill.
const SAYS: Record<string, string> = {
  zoom: "a PNG sheet of frames around a moment, given as M:SS or as a phrase that was said",
  inspect: "print summary.md, or apparent.json with --json",
  frames: "plain PNGs of a time range; prints their paths",
  copy: "copy the capture to the clipboard",
  export: "macOS and Linux: one .mp4 with ink, clicks, synced audio and smooth activity zoom by default (--no-zoom opts out)",
  skill: "print the agent skill without installing anything",
}

function commands(skill: string): string[] {
  const seen = new Map<string, string>()
  let fenced = false
  for (const line of skill.split("\n")) {
    if (line.startsWith("```")) fenced = !fenced
    const m = fenced && line.match(/^(apparent (\w+)[^#]*?)\s*(?:#\s*(.+))?$/)
    if (m && !seen.has(m[2])) seen.set(m[2], `- \`${m[1]}\`: ${SAYS[m[2]] ?? m[3] ?? ""}`.replace(/: $/, ""))
  }
  if (!seen.has("skill")) seen.set("skill", `- \`apparent skill\`: ${SAYS.skill}`)
  return [...seen.values()]
}

export function agentFiles(): Record<string, string> {
  const readme = repo("README.md")
  const skill = repo("skills/apparent/SKILL.md")
  const { version, macos } = release()
  const releaseNote = version ? `Version ${version}, for Apple silicon Mac, macOS ${macos} or later.` : "No Apparent build has been released yet."
  const tagline = readme.split("\n").find((l) => l && !l.startsWith("#"))!.trim()
  const intro = readme.split(/\n## /)[0].split("\n\n").slice(2).join("\n\n").trim()
  const summary = `> ${tagline} Apparent records your screen, voice, clicks and drawings and packs them into a bundle an AI coding agent can read. ${releaseNote}`

  const llms = `# Apparent

${summary}

${intro}

## Install

${version ? `- [Download for Mac](${SITE}/releases/Apparent-latest-arm64.dmg): version ${version}, for macOS ${macos} or later.` : "No branded installer has been published yet. Build from source using the repository instructions."}

## Agents

- [Agent skill](${SITE}/skill.md): install it with \`bunx skills add tryapparent/apparent\`. With it, an agent that gets an Apparent paste reads the contact sheet and transcript, opens the keyframes the narration points at, and uses the \`apparent\` command to look closer.
- [Make it apparent](${REPO}/blob/main/skills/make-it-apparent/SKILL.md): a separate video walkthrough skill; install it explicitly with \`bunx skills add tryapparent/apparent --skill make-it-apparent\`. The capture-reading skill install does not guarantee it is present.
- [SKILL.md on GitHub](${RAW_SKILL}): the same skill, raw, from the main branch.
- [Full text](${SITE}/llms-full.txt): this file plus the install notes, capture controls, CLI and the whole skill in one document.

## Captures

- [Reading a capture](${SITE}/skill.md): what a paste looks like, the files in a \`.apparent\` bundle (\`contact-sheet.png\`, \`frames/frame-NN.png\`, \`summary.md\`, \`apparent.json\`, the recording and \`audio.wav\`), and what the red marks, click ripples and laser trails mean.

## CLI

The \`apparent\` command runs on the computer where Apparent is installed (macOS or Linux). Most commands take a bundle path or \`latest\`.

${commands(skill).join("\n")}

## Optional

- [README](${REPO}#readme): everything else, including desktop capture, saved historical device bundles, auto-crop, local dev-page context, and retention. Captures are copied, not sent to sessions.
- [Source code](${REPO}): Rust and Swift, MIT licensed.
- [Appcast](${SITE}/appcast.xml): the Sparkle update feed.
`

  const full = `# Apparent

${summary}

${intro}

Website: ${SITE}
Source: ${REPO}
Download: no branded build is published yet.

## Install

${section(readme, "## Install")}

## Agents

${section(readme, "## Agents")}

## Capture controls

${section(readme, "## Capture Controls")}

## Export as video

${section(readme, "## Export as video")}

## Keeping captures small

${section(readme, "## Keeping captures small")}

## The agent skill

This is the skill that \`bunx skills add tryapparent/apparent\` installs, also served at <${SITE}/skill.md>.

${shift(unfrontmatter(skill), 2).trim()}
`

  return { "llms.txt": llms, "llms-full.txt": full, "skill.md": skill }
}

export function jsonLd(): string {
  const { version, macos } = release()
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Apparent",
    description: "Show an agent a problem instead of describing it. Apparent records your screen, voice, clicks and drawings and packs them into a bundle an AI coding agent can read.",
    url: `${SITE}/`,
    operatingSystem: macos ? `macOS ${macos}, Linux` : "macOS, Linux",
    applicationCategory: "DeveloperApplication",
    ...(version ? { softwareVersion: version } : {}),
    image: `${SITE}/og.png`,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    author: { "@type": "Person", name: "Kit Langton" },
    sameAs: [REPO],
  })
}
