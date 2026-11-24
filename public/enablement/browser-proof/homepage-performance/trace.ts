import { writeFile } from "node:fs/promises";
import type { CDPSession } from "playwright-core";

type Event = {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
};
export type Span = { stage: string; startMs: number; endMs: number };

export async function startTrace(cdp: CDPSession) {
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,blink.user_timing,loading,blink,cc",
    transferMode: "ReturnAsStream",
  });
  return async (path: string) => {
    const completed = new Promise<string>((done) =>
      cdp.once("Tracing.tracingComplete", ({ stream }) => done(stream!)),
    );
    await cdp.send("Tracing.end");
    const handle = await completed;
    let json = "";
    let eof = false;
    while (!eof) {
      const chunk = await cdp.send("IO.read", { handle });
      json += chunk.base64Encoded
        ? Buffer.from(chunk.data, "base64").toString("utf8")
        : chunk.data;
      eof = chunk.eof;
    }
    await cdp.send("IO.close", { handle });
    await writeFile(path, json);
    return (JSON.parse(json) as { traceEvents: Event[] }).traceEvents;
  };
}

export function rendererSpans(
  events: Event[],
  attempt: string,
  clickMs: number,
): Span[] {
  const click = events.find(
    (event) =>
      event.name === attempt + ":trusted-copy" &&
      event.cat.includes("user_timing"),
  );
  if (!click) throw new Error("Trace is missing the browser clock anchor");
  const origin = click.ts / 1000 - clickMs;
  const stages: Record<string, string> = {
    ParseHTML: "parse html",
    EvaluateScript: "script",
    CompileScript: "script",
    "v8.compile": "script",
    FunctionCall: "script",
    RunMicrotasks: "script",
    UpdateLayoutTree: "style/layout",
    Layout: "style/layout",
    PrePaint: "paint",
    Paint: "paint",
    DecodeImage: "decode image",
    ImageDecodeTask: "decode image",
    Commit: "compositor commit",
  };
  return events.flatMap((event) =>
    event.pid === click.pid &&
    event.tid === click.tid &&
    event.ph === "X" &&
    event.dur &&
    stages[event.name]
      ? [
          {
            stage: stages[event.name],
            startMs: event.ts / 1000 - origin,
            endMs: (event.ts + event.dur) / 1000 - origin,
          },
        ]
      : [],
  );
}

export function account(spans: Span[], endMs: number) {
  const clipped = spans
    .filter((span) => span.startMs < endMs && span.endMs > 0)
    .map((span) => ({
      ...span,
      startMs: Math.max(0, span.startMs),
      endMs: Math.min(endMs, span.endMs),
    }))
    .filter((span) => span.startMs < span.endMs);
  const boundaries = [
    ...new Set([
      0,
      endMs,
      ...clipped.flatMap((span) => [span.startMs, span.endMs]),
    ]),
  ].sort((a, b) => a - b);
  const slices = boundaries.slice(1).map((endMs, i) => ({
    startMs: boundaries[i],
    endMs,
    active: [
      ...new Set(
        clipped
          .filter((span) => span.startMs < endMs && span.endMs > boundaries[i])
          .map((span) => span.stage),
      ),
    ].sort(),
  }));
  const duration = (filter: (active: string[]) => boolean) =>
    slices
      .filter((slice) => filter(slice.active))
      .reduce((total, slice) => total + slice.endMs - slice.startMs, 0);
  return {
    slices,
    unattributedMs: duration((active) => !active.length),
    overlapMs: duration((active) => active.length > 1),
  };
}

export async function writeWaterfall(
  path: string,
  attempt: string,
  endMs: number,
  spans: Span[],
  marks: { name: string; startMs: number }[],
) {
  const { slices, overlapMs, unattributedMs } = account(spans, endMs);
  const escape = (text: string) =>
    text.replace(
      /[&<>"]/g,
      (value) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[value]!,
    );
  const percent = (ms: number) => (ms / endMs) * 100;
  const bar = (start: number, end: number, label: string, type = "work") =>
    `<span class="${type}" style="left:${percent(start)}%;width:${percent(end - start)}%" title="${escape(label)} · ${start.toFixed(2)}–${end.toFixed(2)} ms"></span>`;
  const row = (name: string, bars: string) =>
    `<div class="label">${escape(name)}</div><div class="track">${bars}</div>`;
  const stages = [...new Set(spans.map((span) => span.stage))];
  const rows = stages.map((stage) =>
    row(
      stage,
      slices
        .filter((slice) => slice.active.includes(stage))
        .map((slice) => bar(slice.startMs, slice.endMs, stage))
        .join(""),
    ),
  );
  const overlap = slices.filter((slice) => slice.active.length > 1);
  const unknown = slices.filter((slice) => !slice.active.length);
  rows.push(
    row(
      "Overlap",
      overlap
        .map((slice) =>
          bar(slice.startMs, slice.endMs, slice.active.join(" + "), "overlap"),
        )
        .join(""),
    ),
  );
  rows.push(
    row(
      "Unattributed",
      unknown
        .map((slice) =>
          bar(slice.startMs, slice.endMs, "Unattributed", "unknown"),
        )
        .join(""),
    ),
  );
  for (const mark of marks.filter(
    (mark) => mark.startMs > 0 && mark.startMs <= endMs,
  ))
    rows.push(
      row(
        `${mark.name} · ${mark.startMs.toFixed(2)} ms`,
        bar(mark.startMs, mark.startMs, mark.name, "mark"),
      ),
    );
  await writeFile(
    path,
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Public homepage timing waterfall</title>
<style>
body{margin:2rem auto;max-width:80rem;padding:0 1.25rem;font:1rem system-ui;color:#171a29;background:#f6f8fc}
h1{font-size:1.7rem}p{max-width:46rem;line-height:1.5}
.grid{display:grid;grid-template-columns:minmax(10rem,auto) minmax(4rem,1fr);gap:.35rem 1rem}
.label{padding:.35rem 0}.track{position:relative;background:#e6eaf1;border-radius:.2rem}
.track span{position:absolute;height:100%;background:#245498}.track .mark{width:2px!important;background:#141827}
.track .overlap{background:#67439a}.track .unknown{background:#806033}
</style>
<body><h1>Public homepage timing waterfall</h1><p>Attempt <code>${escape(attempt)}</code></p>
<p>Navigation to verified clipboard ${endMs.toFixed(2)} ms. Overlap ${overlapMs.toFixed(2)} ms. Unattributed ${unattributedMs.toFixed(2)} ms.
Horizontal positions use the document’s monotonic clock. Overlapping labels describe concurrent elapsed time and should be counted once.</p>
<div class="grid"><div></div><div>0 ms <span style="float:right">${endMs.toFixed(2)} ms</span></div>${rows.join("")}</div>
`,
  );
}
