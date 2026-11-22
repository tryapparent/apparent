import { readFileSync } from "node:fs";
import policy, { type Clock, type Items } from "./zoom-plan.mjs";

function clock(value: string): Clock {
  const n = BigInt(value);
  return { $: "Clock", hi: Number(n >> 32n), lo: Number(n & 0xffffffffn) };
}
function decimal(t: Clock) {
  return ((BigInt(t.hi) << 32n) | BigInt(t.lo)).toString();
}
function list<T>(tokens: T[]) {
  return tokens.reduceRight<Items<T>>(
    (tail, head) => ({ $: "Con", head, tail }),
    { $: "Nil" },
  );
}
function normalize(text: string) {
  return text
    .replace(/[^\p{Alphabetic}\p{Number}\p{White_Space}]/gu, "")
    .toLowerCase();
}
function tokens(text: string) {
  return normalize(text)
    .split(/\p{White_Space}+/u)
    .filter(Boolean);
}
type Entry = [string, string];
type Request = {
  moment: string | null;
  phrase: string | null;
  mark: [string, string] | null;
  duration: string;
  span: string;
  count: string;
  words: Entry[];
  segments: Entry[];
  keyframes: string[];
};
function plan(request: Request) {
  let moment = request.moment;
  if (request.phrase !== null) {
    const query = tokens(request.phrase);
    const hit = policy.phrase_hit(
      list(request.words.map(([text]) => normalize(text).replaceAll(" ", ""))),
      list(request.segments.map(([text]) => tokens(text).join(" "))),
      list(query),
      query.join(" "),
    );
    if (!hit.index) return { status: "missing" };
    moment = (hit.word ? request.words : request.segments)[hit.index - 1][1];
  }
  const duration = clock(request.duration);
  const [start, stop] = request.mark ?? [moment!, moment!];
  if (!request.mark && policy.before(duration, clock(start)))
    return { status: "past", at: start };
  const window = policy.zoom_window(
    !!request.mark,
    clock(start),
    clock(stop),
    clock(request.span),
    duration,
  );
  const count = policy.cell_count(
    window.start,
    window.stop,
    clock(request.count),
  );
  const times = Array.from({ length: count }, (_, i) =>
    decimal(policy.cell_time(window.start, window.stop, i, count)),
  );
  const frames = list(request.keyframes.map(clock));
  const nearest = times.map((t) => policy.nearest_cell(frames, clock(t)));
  return {
    status: "plan",
    nearest,
    from: decimal(window.start),
    to: decimal(window.stop),
    times,
  };
}

process.stdout.write(JSON.stringify(plan(JSON.parse(readFileSync(0, "utf8")))));
