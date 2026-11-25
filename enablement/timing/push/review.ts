import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import type { Call } from "../census.ts";
import { privatePath, pushId } from "./receipt.ts";

type Event = {
  schema: 1;
  id: string;
  phase: string;
  at: number;
  code?: number;
};

function readEvents(path: string, id: string): Event[] | undefined {
  try {
    const fd = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let contents: string;
    try {
      const info = fstatSync(fd);
      if (
        !info.isFile() ||
        info.uid !== process.getuid?.() ||
        info.mode & 0o077
      )
        return;
      const buffer = Buffer.alloc(1024);
      const read = readSync(fd, buffer);
      if (read === buffer.length) return;
      contents = buffer.toString("utf8", 0, read);
    } finally {
      closeSync(fd);
    }
    if (!contents.endsWith("\n")) return;
    const events = contents
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Event);
    const phases = ["launch", "verification-start", "verification-exit"];
    if (
      events.length > phases.length ||
      events.some(
        (event, i) =>
          event?.schema !== 1 ||
          event.id !== id ||
          event.phase !== phases[i] ||
          !Number.isSafeInteger(event.at) ||
          event.at < (events[i - 1]?.at ?? 0) ||
          (i === 2 ? !Number.isSafeInteger(event.code) : "code" in event) ||
          Object.keys(event).length !== (i === 2 ? 5 : 4),
      )
    )
      return;
    return events;
  } catch {
    return;
  }
}

function arithmetic(seconds: number[]) {
  const count = seconds.length;
  const totalSeconds = seconds.reduce((sum, value) => sum + value, 0);
  return {
    count,
    meanSeconds: count ? totalSeconds / count : null,
    totalSeconds,
  };
}

export function reviewPushReceipts(
  calls: Call[],
  directory: string,
  from: number,
  to: number,
) {
  if (!privatePath(directory, true))
    throw Error(
      "Runner receipt directory must be private and owned by the reviewing user",
    );
  const candidates = new Map<string, Map<string, Call>>();
  for (const call of calls) {
    const path = call.pushReceipt;
    if (!path) continue;
    const id = pushId(path);
    if (!id || path !== join(directory, id + ".jsonl")) continue;
    const owners = candidates.get(id) ?? new Map<string, Call>();
    const previous = owners.get(call.id);
    if (
      !previous ||
      (previous.pushResult === undefined && call.pushResult !== undefined)
    )
      owners.set(call.id, call);
    candidates.set(id, owners);
  }
  const duration = (start: number, end: number) =>
    Math.max(0, Math.min(end, to) - Math.max(start, from)) / 1000;
  const waitCalls = new Map(
    calls
      .filter((call) => call.pushWaitFor && call.end !== undefined)
      .map((call) => [call.id, call]),
  );
  const waits = new Map<string, Call[]>();
  for (const call of waitCalls.values()) {
    const id = call.pushWaitFor!;
    const group = waits.get(id) ?? [];
    group.push(call);
    waits.set(id, group);
  }
  const coverage = {
    candidates: 0,
    unlinked: 0,
    launchOnly: 0,
    openVerification: 0,
    observedResults: 0,
  };
  const verification: number[] = [],
    waitSeconds: number[] = [];
  const operations = [];
  for (const [id, owners] of candidates) {
    const inWindow = [...owners.values()].some(
      (call) =>
        call.start < to && (call.pushExit?.observedAt ?? call.start) >= from,
    );
    if (!inWindow) continue;
    coverage.candidates++;
    const [call] = owners.values();
    const events =
      owners.size === 1 && call.pushResult && call.end !== undefined
        ? readEvents(call.pushReceipt!, id)
        : undefined;
    const [launch, start, exit] = events ?? [];
    if (
      !launch ||
      launch.at < call.start ||
      launch.at > call.end! ||
      (call.pushExit &&
        events!.some((event) => event.at > call.pushExit!.observedAt))
    ) {
      coverage.unlinked++;
      continue;
    }
    if (!start || start.at >= to) coverage.launchOnly++;
    else if (!exit || exit.at > to) coverage.openVerification++;
    else if (exit.at >= from) verification.push(duration(start.at, exit.at));
    const result =
      call.pushExit && call.pushExit.observedAt <= to
        ? call.pushExit
        : undefined;
    if (result) coverage.observedResults++;
    const linked = (waits.get(call.id) ?? []).filter(
      (wait) => wait.start < to && wait.end! > from,
    );
    waitSeconds.push(...linked.map((wait) => duration(wait.start, wait.end!)));
    operations.push({
      id,
      launchCall: call.id,
      waits: linked.map((wait) => wait.id),
      result,
    });
  }
  return {
    schema: 1,
    coverage,
    operations,
    verification: arithmetic(verification),
    toolWaits: arithmetic(waitSeconds),
  };
}
