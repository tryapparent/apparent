import { inkPath } from "./ink"

export type Mode = "mac"
export type Point = [number, number]
export type Rect = { x: number; y: number; w: number; h: number }

export const STAGE = { w: 1200, h: 720 }
export const INK = "#ff3b30"

export const MENUBAR_H = 28
export const MAC_WINDOW: Rect = { x: 52, y: 78, w: 684, h: 540 }
export const AGENT: Rect = { x: 760, y: 48, w: 422, h: 640 }
export const AREA: Rect = { x: 40, y: 66, w: 708, h: 564 }

// A tap of ⌥⇧S records the screen as the keys come up (`keysUp`), with a red edge glow, and the
// capsule shows Area · Window · Screen until `REVEAL_MS` pass or the first stroke.
// The narration and the marks are timed from `record`; another tap finishes at `finish`.
export const T = {
  keys: 2000,
  keysUp: 2300,
  record: 3600,
  circle: [5600, 7100] as const,
  pin1: 7600,
  arrow: [9200, 9900] as const,
  head: [10000, 10350] as const,
  pin2: 11000,
  finish: 13900,
  copied: 14600,
  promptClick: 15000,
  paste: 15200,
  submit: 15700,
  read: 16300,
  edit: 16800,
  diff: 17000,
  fix: [18300, 19300] as const,
  done: 19700,
  end: 21300,
}

// `crate::shortcut::REVEAL_MS`.
export const REVEAL_MS = 3500

// When the desktop recording starts.
export const recStart = (_mode: Mode, _t = Infinity) => T.keysUp

// When the switch chips fold into Cancel · Finish.
export const revealEnd = (_mode: Mode) => Math.min(T.keysUp + REVEAL_MS, T.circle[0])

export const BEATS = [
  { label: "Broken", t: 0 },
  { label: "Capture", t: 1800 },
  { label: "Annotate", t: T.record },
  { label: "Handoff", t: 13700 },
  { label: "Fix", t: 16600 },
] as const

// Word onsets in ms from the start of the new, locally synthesized Pi-cut narration.
const MAC_WORDS: [string, number][] = [
  ["The", 1100], ["live", 1380], ["badge", 1680], ["overlaps", 2050], ["the", 2600], ["title.", 2790],
  ["And", 5400], ["the", 5660], ["buttons", 5850], ["sit", 6170], ["too", 6390], ["low.", 6600],
  ["Move", 6970], ["the", 7220], ["badge", 7410], ["and", 7700], ["align", 7960], ["the", 8230], ["row.", 8460],
]

export type Narration = {
  src: string
  // [word, start, end] on the demo clock.
  words: [string, number, number][]
  // Index of the word that opens the second clause.
  clause2: number
  // Demo-clock time when the file ends.
  end: number
  // Seconds into the file to hold silent.
  mute: [number, number][]
}

// Narration starts after the capture begins, with a pause between the two marks.
const narration = (src: string, spoken: [string, number][], speechEnd: number, duration: number, mute: [number, number][]): Narration => {
  const words = spoken.map(([w, at], i): [string, number, number] => {
    const next = spoken[i + 1]?.[1] ?? speechEnd
    return [w, T.record + at, T.record + Math.min(next - 40, at + 520)]
  })
  return { src, words, clause2: spoken.findIndex(([w]) => w.toLowerCase() === "and"), end: T.record + duration, mute }
}

export const NARRATION: Record<Mode, Narration> = {
  mac: narration("/apparent-narration-mac.mp3", MAC_WORDS, 8900, 10000, []),
}

export const WORDS = NARRATION.mac.words

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p
export const progress = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
export const easeOut = (p: number) => 1 - Math.pow(1 - p, 3)
export const easeOutBack = (p: number) => {
  const c1 = 1.4
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2)
}

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

export type Pill = "notch" | "reveal" | "recording" | "processing" | "copied"

export const pillState = (t: number, mode: Mode): Pill => {
  if (t < T.keysUp) return "notch"
  if (t < revealEnd(mode)) return "reveal"
  if (t < T.finish + 50) return "recording"
  if (t < T.copied) return "processing"
  return "copied"
}

// Mirrors the HUD in src/ui.rs: a 40px capsule, 4px inset, 32px chips with 2px gaps. Item widths
// are fixed (a divider is 1px plus 6px margins) so the scripted cursor can hit exact chip centers.
export const PILL = {
  cx: STAGE.w / 2,
  top: MENUBAR_H + 10,
  h: 40,
  inset: 4,
  gap: 2,
  items: {
    // Lead (dot + clock), divider, Area · Window · Screen, divider, ×.
    reveal: [70, 13, 56, 72, 66, 13, 32],
    recording: [70, 13, 68, 68],
    processing: [132],
    copied: [98, 13, 62, 74, 32],
  },
}
export const PILL_CY = PILL.top + PILL.h / 2

export const pillWidth = (items: number[]) => items.reduce((a, b) => a + b, 0) + PILL.gap * (items.length - 1) + PILL.inset * 2


// The home-screen prompt row inside the Pi terminal (see Terminal in stage-parts.tsx).
export const PROMPT_AT: Point = [AGENT.x + 150, AGENT.y + 356]

export type Anchors = { badge: Rect; actions: Rect; title: Rect }

export type Stroke = { id: string; points: Point[]; t0: number; t1: number; fullPath: string; sheetPath: string }
export type Pin = { n: number; t: number; at: Point }
export type Click = { t: number; at: Point }
export type Waypoint = { t: number; at: Point; arc?: number }

export type Script = {
  strokes: Stroke[]
  // Where the spoken caption pill's right edge sits (vertically centered) for each clause.
  speech: [Point, Point]
  pins: Pin[]
  clicks: Click[]
  path: Waypoint[]
  frames: { n: number; t: number; strokes: string[]; pins: number[] }[]
  narration: Narration
}

const circlePoints = (cx: number, cy: number, rx: number, ry: number): Point[] => {
  const pts: Point[] = []
  const start = -2.5
  const sweep = Math.PI * 2 * 1.1
  const n = 96
  for (let i = 0; i <= n; i++) {
    const k = i / n
    const a = start + sweep * k
    // A slow outward drift lets the overlap land beside the start instead of on top of it.
    const grow = 1 + k * 0.06
    pts.push([cx + Math.cos(a) * rx * grow, cy + Math.sin(a) * ry * grow - k * 4])
  }
  return pts
}

const curvePoints = (s: Point, c: Point, e: Point, n = 36): Point[] => {
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) {
    const k = i / n
    const u = 1 - k
    pts.push([u * u * s[0] + 2 * u * k * c[0] + k * k * e[0], u * u * s[1] + 2 * u * k * c[1] + k * k * e[1]])
  }
  return pts
}

const line = (a: Point, b: Point, n = 10): Point[] =>
  Array.from({ length: n + 1 }, (_, i) => [lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)] as Point)

const center = (r: Rect): Point => [r.x + r.w / 2, r.y + r.h / 2]

const makeStroke = (id: string, points: Point[], t0: number, t1: number): Stroke => ({
  id,
  points,
  t0,
  t1,
  fullPath: inkPath(points, 4.5, 0),
  sheetPath: inkPath(points, 10, 0),
})

export function buildScript(mode: Mode, a: Anchors): Script {
  const badge = center(a.badge)
  const circle = circlePoints(badge[0] - 10, badge[1], a.badge.w / 2 + 40, a.badge.h / 2 + 15)

  // On the Mac the arrow swings up from below-left into the clipped "Retry failed" button.
  const buttons = a.actions.x + a.actions.w - 200
  const tip: Point = [buttons - 10, a.actions.y + a.actions.h * 0.6]
  const start: Point = [tip[0] - 104, tip[1] + 52]
  const ctrl: Point = [tip[0] - 44, tip[1] + 46]
  const shaft = curvePoints(start, ctrl, tip, 40)
  // A quadratic's end tangent points from the control point to the tip.
  const angle = Math.atan2(tip[1] - ctrl[1], tip[0] - ctrl[0])
  const wing = (side: number): Point => [tip[0] - Math.cos(angle + side * 0.5) * 19, tip[1] - Math.sin(angle + side * 0.5) * 19]
  const wing1 = wing(1)
  const wing2 = wing(-1)
  const head1 = line(tip, wing1, 12)
  const head2 = line(tip, wing2, 12)
  const headMid = Math.round((T.head[0] + T.head[1]) / 2)

  const strokes: Stroke[] = [
    makeStroke("circle", circle, T.circle[0], T.circle[1]),
    makeStroke("shaft", shaft, T.arrow[0], T.arrow[1]),
    makeStroke("wing1", head1, T.head[0], headMid - 15),
    makeStroke("wing2", head2, headMid + 15, T.head[1]),
  ]

  // The pill rides to the left of each mark, so it never covers the ink or the thing being
  // described, and its glide between clauses never crosses the circle.
  const circleLeft = Math.min(...circle.map((p) => p[0]))
  const speech: Script["speech"] = [[circleLeft - 12, badge[1]], [start[0] - 20, start[1]]]

  const pin1: Point = [a.badge.x + a.badge.w + 2, a.badge.y - 2]
  const pin2: Point = [a.actions.x + a.actions.w - 92, a.actions.y + 10]
  const pins: Pin[] = [
    { n: 1, t: T.pin1, at: pin1 },
    { n: 2, t: T.pin2, at: pin2 },
  ]

  const prompt: Point = PROMPT_AT
  const clicks: Click[] = [...pins.map((p) => ({ t: p.t, at: p.at })), { t: T.promptClick, at: prompt }]

  const path: Waypoint[] = [
    { t: 0, at: [840, 540] },
    { t: 320, at: [840, 540], arc: -0.07 },
    { t: 1650, at: [520, 300], arc: 0 },
  ]

  path.push({ t: T.circle[0] - 1400, at: [520, 300], arc: 0.06 })

  const restAfterPin2: Point = [pin2[0] + 28, pin2[1] + 34]

  path.push(
    { t: T.circle[0] - 80, at: circle[0], arc: 0 },
    { t: T.circle[0], at: circle[0], arc: 0 },
    { t: T.circle[1], at: circle[circle.length - 1], arc: 0.05 },
    { t: T.pin1 - 70, at: pin1, arc: 0 },
    { t: T.pin1 + 160, at: pin1, arc: -0.06 },
    { t: T.arrow[0] - 80, at: shaft[0], arc: 0 },
    { t: T.arrow[0], at: shaft[0], arc: 0 },
    { t: T.arrow[1], at: tip, arc: 0 },
    { t: T.head[0], at: tip, arc: 0 },
    { t: headMid - 15, at: wing1, arc: 0 },
    { t: headMid + 15, at: tip, arc: 0 },
    { t: T.head[1], at: wing2, arc: 0.05 },
    { t: T.pin2 - 70, at: pin2, arc: 0 },
    { t: T.pin2 + 160, at: pin2, arc: 0.04 },
    { t: T.pin2 + 650, at: restAfterPin2, arc: 0 },
    { t: T.finish + 170, at: restAfterPin2, arc: 0.06 },
    { t: T.promptClick - 90, at: prompt, arc: 0 },
    { t: T.promptClick + 130, at: prompt, arc: 0.06 },
    { t: T.paste + 680, at: [AGENT.x - 18, AGENT.y + AGENT.h - 10], arc: 0 },
  )

  return {
    strokes,
    speech,
    pins,
    clicks,
    path,
    narration: NARRATION[mode],
    frames: [
      { n: 1, t: T.pin1 - T.record, strokes: ["circle"], pins: [1] },
      { n: 2, t: T.pin2 - T.record, strokes: ["shaft", "wing1", "wing2"], pins: [2] },
    ],
  }
}

// The tip is interpolated between samples so the stroke grows continuously every frame.
export function strokeAt(s: Stroke, t: number) {
  if (t <= s.t0) return null
  if (t >= s.t1) return { points: s.points, tip: s.points[s.points.length - 1], done: true, d: s.fullPath }
  const p = easeInOut(progress(t, s.t0, s.t1))
  const last = s.points.length - 1
  const at = p * last
  const i = Math.floor(at)
  if (i >= last) return { points: s.points, tip: s.points[last], done: true, d: s.fullPath }
  const frac = at - i
  const a = s.points[i]
  const b = s.points[i + 1]
  const tip: Point = [lerp(a[0], b[0], frac), lerp(a[1], b[1], frac)]
  const head = i > 0 && frac < 0.2 ? s.points.slice(0, i) : s.points.slice(0, i + 1)
  const pts = [...head, tip]
  return { points: pts, tip, done: false, d: inkPath(pts, 4.5, 0) }
}

export type Cursor = { at: Point; drawing: boolean; pressed: boolean; shift: boolean }

export function cursorAt(script: Script, t: number): Cursor {
  const active = script.strokes.find((s) => t > s.t0 && t < s.t1)
  const pressed = script.clicks.some((c) => t >= c.t - 60 && t < c.t + 140)
  const shift = !!active || script.pins.some((p) => t >= p.t - 250 && t < p.t + 250)
  if (active) {
    return { at: strokeAt(active, t)!.tip, drawing: true, pressed: true, shift: true }
  }
  const path = script.path
  if (t <= path[0].t) return { at: path[0].at, drawing: false, pressed, shift }
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    if (t <= b.t) {
      const k = easeInOut(progress(t, a.t, b.t))
      const dx = b.at[0] - a.at[0]
      const dy = b.at[1] - a.at[1]
      const dist = Math.hypot(dx, dy)
      const arc = a.arc ?? 0
      let at: Point
      if (dist > 8 && arc !== 0) {
        const bend = arc * Math.min(240, dist)
        const nx = -dy / dist
        const ny = dx / dist
        const s = 4 * k * (1 - k)
        at = [lerp(a.at[0], b.at[0], k) + nx * bend * s, lerp(a.at[1], b.at[1], k) + ny * bend * s]
      } else {
        at = [lerp(a.at[0], b.at[0], k), lerp(a.at[1], b.at[1], k)]
      }
      return {
        at,
        drawing: false,
        pressed,
        shift,
      }
    }
  }
  return { at: path[path.length - 1].at, drawing: false, pressed, shift }
}

// Splits a narration into its two keyframe clauses.
export const clauses = (mode: Mode) => {
  const { words, clause2 } = NARRATION[mode]
  const text = (ws: typeof words) => ws.map(([w]) => w).join(" ")
  return [text(words.slice(0, clause2)), text(words.slice(clause2))]
}

export const summaryText = (mode: Mode, short = false) => {
  const dir = short ? "~/…/captures" : "~/Library/Application Support/apparent/captures"
  const target = "Pulse “Deploy Activity”"
  const [first, second] = clauses(mode)
  const start = recStart(mode)
  return [
    `[apparent ${clock(T.finish - start)} · ${target} · ${dir}/apparent-1791924018273-3a1f.apparent]`,
    `- #1 (${clock(T.pin1 - start)}) “${first}”`,
    `- #2 (${clock(T.pin2 - start)}) “${second}”`,
  ]
}
