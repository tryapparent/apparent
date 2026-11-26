import type { Call } from "../census.ts";
import { pushId } from "../push/receipt.ts";

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

const execScript = (source: string) =>
  source.replace(/^\/\/ @exec:[^\r\n]*\r?\n/, "").trim();

function singlePrintedPoll(script: string): string | undefined {
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

const completedScriptHeader =
  /^Script completed\nWall time \d+(?:\.\d+)? seconds\nOutput:\n$/;

function structuredExecResult(output: unknown, compact = false) {
  if (!Array.isArray(output) || output.length !== 2) return;
  const [header, body] = output;
  if (
    header?.type !== "input_text" ||
    typeof header.text !== "string" ||
    body?.type !== "input_text" ||
    typeof body.text !== "string" ||
    !completedScriptHeader.test(header.text)
  )
    return;
  const result = jsonObject(body.text);
  if (
    result &&
    typeof result.chunk_id === "string" &&
    Number.isFinite(result.wall_time_seconds) &&
    Number.isSafeInteger(result.original_token_count) &&
    typeof result.output === "string" &&
    (!compact ||
      (Object.keys(result).length === 5 &&
        JSON.stringify(result) === body.text))
  )
    return result;
}

const isExec = (tool: string) => tool === "exec" || tool === "functions.exec";

function storedLaunch(script: string) {
  const match = script.match(
    /^const\s+([A-Za-z_]\w*)\s*=\s*await\s+tools\.exec_command\(\s*\{\s*cmd\s*:\s*\x60((?:[^\x60\\$]|\\[\s\S]|\$(?!\{))*)\x60\s*,\s*yield_time_ms\s*:\s*\d+\s*\}\s*\)\s*;\s*store\(\s*"([\w-]+)"\s*,\s*\1\.session_id\s*\)\s*;\s*(?:store\(\s*"([\w-]+)"\s*,\s*\1\.output\.trim\(\)\s*\)\s*;\s*)?text\(\s*\1\s*\)\s*;?$/,
  );
  return match && match[3] !== match[4]
    ? { key: match[3], command: match[2] }
    : undefined;
}

function pushReceipt(script: string) {
  const command =
    storedLaunch(script)?.command ??
    script.match(
      /^text\(\s*await\s+tools\.exec_command\(\s*\{\s*cmd\s*:\s*(["\x60])([^"\x60\n]*)\1\s*,\s*yield_time_ms\s*:\s*\d+\s*\}\s*\)\s*\)\s*;?$/,
    )?.[2];
  const path = command?.match(
    /^node --experimental-strip-types enablement\/local-tests\/execution\/push\.ts --runner-timing (\/[a-zA-Z0-9_./-]+)(?: --(?:jobs|min-jobs|total-budget) [0-9.]+)* --(?: [a-zA-Z0-9_./:=+@-]+)*$/,
  )?.[1];
  return path && pushId(path) ? path : undefined;
}

function storedPollKey(script: string) {
  return script.match(
    /^text\(\s*await\s+tools\.write_stdin\(\s*\{\s*session_id\s*:\s*load\(\s*"([\w-]+)"\s*\)\s*(?:,\s*chars\s*:\s*""\s*)?(?:,\s*yield_time_ms\s*:\s*\d+\s*)?(?:,\s*max_output_tokens\s*:\s*\d+\s*)?,?\s*\}\s*\)\s*\)\s*;?$/,
  )?.[1];
}

type StoredSession = {
  key: string;
  launch: Call;
  sessionId: number;
  observedAt: number;
};

export class YieldedPolls {
  private launches = new WeakSet<Call>();
  private runnerSessions = new WeakMap<Call, number>();
  private polls = new Map<string, Call>();
  private cells = new Map<string, Call>();
  private waits = new Map<string, string>();
  private activeScripts = new Set<Call>();
  private yieldedScripts = new Map<string, boolean>();
  private scriptWaits = new Map<string, string>();
  private stored?: StoredSession;
  private pendingStore?: { call: Call; key: string; session?: StoredSession };

  invalidateStored() {
    this.stored = undefined;
    this.pendingStore = undefined;
  }

  private startStored(call: Call, script: string, type: string) {
    const session = this.stored;
    this.invalidateStored();
    const overlapping =
      this.activeScripts.size > 0 || this.yieldedScripts.size > 0;
    this.activeScripts.add(call);
    if (overlapping || type !== "custom_tool_call") return;
    const binding = storedLaunch(script);
    if (binding) this.pendingStore = { call, key: binding.key };
    else if (
      session &&
      session.launch.processObservedEnd === undefined &&
      this.launches.has(session.launch) &&
      session.observedAt <= call.start &&
      storedPollKey(script) === session.key
    )
      this.pendingStore = { call, key: session.key, session };
  }

  private finishStored(call: Call, type: string, output: unknown) {
    const pending = this.pendingStore;
    if (pending?.call !== call) return;
    this.pendingStore = undefined;
    if (call.end === undefined || type !== "custom_tool_call_output") return;
    const result = structuredExecResult(output, true);
    if (!result) return;
    const sessionId = result.session_id;
    const running =
      typeof sessionId === "number" &&
      Number.isSafeInteger(sessionId) &&
      sessionId > 0 &&
      !("exit_code" in result);
    const session = pending.session;
    if (!session) {
      if (running && this.launches.has(call))
        this.stored = {
          key: pending.key,
          launch: call,
          sessionId,
          observedAt: call.end,
        };
      return;
    }
    const { launch } = session;
    if (!this.launches.has(launch) || launch.processObservedEnd !== undefined)
      return;
    const terminal =
      Number.isSafeInteger(result.exit_code) && !("session_id" in result);
    if (running && sessionId === session.sessionId)
      this.stored = { ...session, observedAt: call.end };
    else if (terminal) launch.processObservedEnd = call.end;
    else return;
    call.waitedOperations = launch.operations;
    this.runnerPoll(launch, call, result);
  }

  private runnerPoll(
    launch: Call,
    poll: Call,
    result: Record<string, unknown>,
  ) {
    const session = this.runnerSessions.get(launch);
    if (
      session === undefined ||
      !this.launches.has(launch) ||
      poll.end === undefined ||
      launch.pushExit !== undefined
    )
      return;
    if (Number.isSafeInteger(result.exit_code) && !("session_id" in result)) {
      launch.pushExit = {
        code: result.exit_code as number,
        observedAt: poll.end,
      };
    } else if (result.session_id !== session || "exit_code" in result) return;
    poll.pushWaitFor = launch.id;
  }

  launch(
    call: Call,
    sessionId: string,
    output: unknown,
    previous: Call | undefined,
  ) {
    if (previous) {
      this.launches.delete(previous);
      previous.pushResult = false;
    } else if (isExec(call.tool) && call.end !== undefined) {
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
      const script = execScript(source);
      if (type === "custom_tool_call") call.pushReceipt = pushReceipt(script);
      this.startStored(call, script, type);
      const sessionId = singlePrintedPoll(script);
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
      this.invalidateStored();
      const args = jsonObject(source);
      if (typeof args?.cell_id === "string") {
        if (this.yieldedScripts.get(args.cell_id))
          this.scriptWaits.set(call.id, args.cell_id);
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
    const yieldedId =
      typeof output === "string"
        ? output.match(
            /^Script running with cell ID ([\w:.-]+)\nWall time \d+(?:\.\d+)? seconds\nOutput:\n$/,
          )?.[1]
        : undefined;
    if (call.end !== undefined && this.activeScripts.delete(call) && yieldedId)
      this.yieldedScripts.set(yieldedId, !seenCell);
    const scriptWait = this.scriptWaits.get(call.id);
    this.scriptWaits.delete(call.id);
    if (
      scriptWait &&
      call.end !== undefined &&
      type === "function_call_output"
    ) {
      const header =
        Array.isArray(output) && output[0]?.type === "input_text"
          ? output[0].text
          : output;
      if (
        this.yieldedScripts.get(scriptWait) &&
        typeof header === "string" &&
        completedScriptHeader.test(header)
      )
        this.yieldedScripts.delete(scriptWait);
    }
    this.finishStored(call, type, output);
    if (call.end === undefined) return;
    if (call.pushReceipt && type === "custom_tool_call_output") {
      const result = structuredExecResult(output, true);
      if (
        result &&
        this.launches.has(call) &&
        typeof result.session_id === "number"
      ) {
        this.runnerSessions.set(call, result.session_id);
        call.pushResult = true;
      } else if (
        result &&
        Number.isSafeInteger(result.exit_code) &&
        !("session_id" in result)
      ) {
        call.pushResult = true;
        call.pushExit = {
          code: result.exit_code as number,
          observedAt: call.end,
        };
      }
    }
    const polled = this.polls.get(call.id);
    this.polls.delete(call.id);
    const waited = this.waits.get(call.id);
    this.waits.delete(call.id);
    if (yieldedId && polled && !seenCell) this.cells.set(yieldedId, polled);
    else if (cellId && cellId !== waited) this.cells.delete(cellId);
    if (polled && !yieldedId && type === "custom_tool_call_output") {
      const result = structuredExecResult(output, true);
      if (result) this.runnerPoll(polled, call, result);
    }
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
    const receipt = structuredExecResult(output, true);
    if (receipt) this.runnerPoll(launch, call, receipt);
  }
}
