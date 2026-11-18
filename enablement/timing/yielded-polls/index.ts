import type { Call } from "../census.ts";

function jsonObject(source: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(source);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function singlePrintedPoll(source: string): string | undefined {
  const script = source.replace(/^\/\/ @exec:[^\r\n]*\r?\n/, "").trim();
  const direct = script.match(/^text\(\s*([\s\S]+)\s*\)\s*;?$/);
  const loop = script.match(
    /^let\s+([A-Za-z_]\w*)\s*;\s*do\s*\{\s*\1\s*=\s*([\s\S]+?)\s*;?\s*\}\s*while\s*\(\s*\1\.session_id\s*\)\s*;\s*text\(\s*\1\s*\)\s*;?$/,
  );
  const poll = direct?.[1] ?? loop?.[2];
  return poll
    ?.trim()
    .match(
      /^await\s+tools\.write_stdin\(\s*\{\s*session_id\s*:\s*([1-9]\d*)\s*(?:,\s*chars\s*:\s*""\s*)?(?:,\s*yield_time_ms\s*:\s*\d+\s*)?(?:,\s*max_output_tokens\s*:\s*\d+\s*)?,?\s*\}\s*\)$/,
    )?.[1];
}

function structuredExecResult(output: unknown) {
  if (!Array.isArray(output) || output.length !== 2) return;
  const [header, body] = output;
  if (
    header?.type !== "input_text" ||
    typeof header.text !== "string" ||
    body?.type !== "input_text" ||
    typeof body.text !== "string" ||
    !/^Script completed\nWall time \d+(?:\.\d+)? seconds\nOutput:\n$/.test(
      header.text,
    )
  )
    return;
  const result = jsonObject(body.text);
  if (
    result &&
    typeof result.chunk_id === "string" &&
    Number.isFinite(result.wall_time_seconds) &&
    Number.isSafeInteger(result.original_token_count) &&
    typeof result.output === "string"
  )
    return result;
}

const isExec = (tool: string) => tool === "exec" || tool === "functions.exec";

export class YieldedPolls {
  private launches = new WeakSet<Call>();
  private polls = new Map<string, Call>();
  private cells = new Map<string, Call>();
  private waits = new Map<string, string>();

  launch(
    call: Call,
    sessionId: string,
    output: unknown,
    previous: Call | undefined,
  ) {
    if (previous) this.launches.delete(previous);
    else if (isExec(call.tool) && call.end !== undefined) {
      const result = structuredExecResult(output);
      if (
        result &&
        Number.isSafeInteger(result.session_id) &&
        String(result.session_id) === sessionId &&
        !("exit_code" in result)
      )
        this.launches.add(call);
    }
  }

  start(
    call: Call,
    source: string,
    type: string,
    processes: ReadonlyMap<string, Call>,
  ) {
    if (isExec(call.tool)) {
      const sessionId = singlePrintedPoll(source);
      const launch = sessionId ? processes.get(sessionId) : undefined;
      if (
        launch?.end !== undefined &&
        launch.end <= call.start &&
        this.launches.has(launch)
      )
        this.polls.set(call.id, launch);
    }
    if (
      type === "function_call" &&
      (call.tool === "wait" || call.tool === "functions.wait")
    ) {
      const args = jsonObject(source);
      if (typeof args?.cell_id === "string") {
        if (args.terminate === true) this.cells.delete(args.cell_id);
        else if (this.cells.has(args.cell_id))
          this.waits.set(call.id, args.cell_id);
      }
    }
  }

  finish(
    call: Call,
    type: string,
    output: unknown,
    cellId: string | undefined,
    seenCell: boolean,
  ) {
    if (call.end === undefined) return;
    const yieldedId =
      typeof output === "string"
        ? output.match(
            /^Script running with cell ID ([\w:.-]+)\nWall time \d+(?:\.\d+)? seconds\nOutput:\n$/,
          )?.[1]
        : undefined;
    const polled = this.polls.get(call.id);
    this.polls.delete(call.id);
    const waited = this.waits.get(call.id);
    this.waits.delete(call.id);
    if (yieldedId && polled && !seenCell) this.cells.set(yieldedId, polled);
    else if (cellId && cellId !== waited) this.cells.delete(cellId);
    if (!waited || yieldedId === waited) return;
    const launch = this.cells.get(waited);
    this.cells.delete(waited);
    if (
      launch &&
      type === "function_call_output" &&
      this.launches.has(launch)
    ) {
      const result = structuredExecResult(output);
      if (
        result &&
        Number.isSafeInteger(result.exit_code) &&
        !("session_id" in result)
      )
        launch.processObservedEnd ??= call.end;
    }
  }
}
