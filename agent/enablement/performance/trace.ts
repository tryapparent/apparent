import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type Endpoint = {
  id: string;
  pid: number;
  startNs: string;
  endNs: string;
  stdoutBytes: number;
};
type Mark = {
  name: string;
  edge: "begin" | "end" | "at";
  pid: number;
  tid: number;
  ns: bigint;
  bytes: number;
};
type Span = {
  name: string;
  tid: number;
  start: bigint;
  end: bigint;
  bytes?: number;
};

const symbols = {
  main: "apparent::main",
  "pen-preference": "apparent::shared::handoff::pen::refresh",
  "cli-bootstrap": "apparent::composition::run",
  "cli-dispatch": "apparent::composition::cli::run_cli",
  inspect: "apparent::composition::transcript::inspect",
  "source-routing": "apparent::connect::hosted::inspect_source",
  "bundle-load-and-parse": "apparent::shared::handoff::load_bundle",
  "bundle-resolve": "apparent::shared::handoff::resolve_bundle_dir",
  interpretation: "apparent::capture::engine::sketch::summary_markdown",
  "interpretation-formatting":
    "apparent::capture::engine::sketch::summary_markdown_formatted",
} as const;

const required = [
  "main",
  "inspect",
  "bundle-load-and-parse",
  "interpretation-formatting",
  "stdout",
];
const nsToMs = (ns: bigint) => Number(ns) / 1e6;

function symbolAddresses(binary: string) {
  const nm = (format: string) =>
    execFileSync("nm", [format, "--defined-only", binary], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\n")
      .map((line) => line.match(/^([a-f0-9]+) [tT] (.+)$/));
  const raw = new Map(
    nm("--no-demangle").flatMap((match) =>
      match ? [[match[1], match[2]]] : [],
    ),
  );
  const readable = new Map(
    nm("--demangle").flatMap((match) => (match ? [[match[2], match[1]]] : [])),
  );
  return Object.entries(symbols).flatMap(([name, symbol]) => {
    const address = readable.get(symbol);
    const entry = address && raw.get(address);
    if (!entry) return [];
    assert(/^[a-zA-Z_][\w.]*$/.test(entry));
    return [[name, entry] as const];
  });
}

export function analyzeTrace(endpoint: Endpoint, marks: Mark[]) {
  const start = BigInt(endpoint.startNs),
    end = BigInt(endpoint.endNs);
  assert(end > start);
  const completed: Span[] = [];
  const milestones = new Map<string, Mark>();
  const current = new Map<string, Mark>();
  for (const mark of marks
    .filter(({ pid }) => pid === endpoint.pid)
    .toSorted((a, b) => (a.ns < b.ns ? -1 : Number(a.ns > b.ns)))) {
    const key = mark.tid + ":" + mark.name;
    assert(
      mark.ns >= start && mark.ns <= end,
      "Probe timestamp outside outer monotonic wait",
    );
    if (mark.edge === "at") {
      assert(!milestones.has(mark.name), "Duplicate milestone " + mark.name);
      milestones.set(mark.name, mark);
    } else if (mark.edge === "begin") {
      assert(!current.has(key), "Reentrant or duplicate trace event: " + key);
      current.set(key, mark);
    } else {
      const opening = current.get(key);
      assert(opening, "Missing entry for " + key);
      completed.push({
        name: mark.name,
        tid: mark.tid,
        start: opening.ns,
        end: mark.ns,
        bytes: mark.bytes,
      });
      current.delete(key);
    }
  }
  assert.equal(current.size, 0, "Unclosed probes");
  for (const name of required)
    assert(
      completed.some((span) => span.name === name),
      "Missing required span " + name,
    );
  const main = completed.find((span) => span.name === "main")!;
  const exec = milestones.get("exec")?.ns;
  const entry = milestones.get("elf-entry")?.ns;
  const exit = milestones.get("exit");
  assert(
    exec !== undefined &&
      entry !== undefined &&
      exec < entry &&
      entry < main.start,
    "Missing kernel exec event before native main",
  );
  assert(
    exit && exit.ns > main.end && exit.bytes > 0,
    "Missing process-exit CPU accounting",
  );
  const stdout = completed.filter((span) => span.name === "stdout");
  const stdoutBytes = stdout.reduce((sum, span) => sum + (span.bytes ?? 0), 0);
  assert.equal(
    stdoutBytes,
    endpoint.stdoutBytes,
    "Probe bytes differ from verified stdout",
  );

  const spans = [
    { name: "observer-launch-to-exec", tid: main.tid, start, end: exec },
    {
      name: "exec-to-elf-entry",
      tid: main.tid,
      start: exec,
      end: entry,
    },
    {
      name: "elf-entry-to-native-main",
      tid: main.tid,
      start: entry,
      end: main.start,
    },
    ...completed,
    {
      name: "main-return-to-kernel-exit",
      tid: main.tid,
      start: main.end,
      end: exit.ns,
    },
    { name: "kernel-exit-to-observer", tid: main.tid, start: exit.ns, end },
  ].toSorted((a, b) =>
    a.start === b.start ? (a.end > b.end ? -1 : 1) : a.start < b.start ? -1 : 1,
  );
  const result = spans.map((span, index) => {
    const parent = spans.findLastIndex(
      (outer, previous) =>
        previous < index &&
        outer.tid === span.tid &&
        outer.start <= span.start &&
        outer.end >= span.end,
    );
    return {
      id: index + 1,
      parent: parent + 1,
      name: span.name,
      tid: span.tid,
      startNs: String(span.start),
      endNs: String(span.end),
      ms: nsToMs(span.end - span.start),
      ...(span.bytes ? { bytes: span.bytes } : {}),
    };
  });

  const points = [
    ...new Set(spans.flatMap((span) => [span.start, span.end])),
  ].sort((a, b) => (a < b ? -1 : Number(a > b)));
  let unattributed = 0n,
    concurrent = 0n;
  const criticalPath = points.slice(1).map((after, index) => {
    const before = points[index];
    const active = spans.filter(
      (span) => span.start <= before && span.end >= after,
    );
    const leaves = active.filter(
      (span) =>
        !active.some(
          (nested) =>
            nested !== span &&
            nested.tid === span.tid &&
            nested.start >= span.start &&
            nested.end <= span.end,
        ),
    );
    const attributed = leaves.filter(
      (span) =>
        !["main", "inspect", "cli-dispatch", "cli-bootstrap"].includes(
          span.name,
        ),
    );
    if (!attributed.length) unattributed += after - before;
    if (new Set(leaves.map(({ tid }) => tid)).size > 1)
      concurrent += after - before;
    return {
      startNs: String(before),
      endNs: String(after),
      ms: nsToMs(after - before),
      operations: attributed.map(({ name }) => name),
    };
  });
  return {
    attemptId: endpoint.id,
    pid: endpoint.pid,
    clock: "linux-monotonic",
    spans: result,
    criticalPath,
    cpuMs: exit.bytes / 1e6,
    firstStdoutMs: nsToMs(stdout[0].start - start),
    completeStdoutMs: nsToMs(stdout.at(-1)!.end - start),
    unattributedMs: nsToMs(unattributed),
    concurrentMs: nsToMs(concurrent),
  };
}

export async function probe<T extends Endpoint>(
  binary: string,
  directory: string,
  count: number,
  run: () => T[],
) {
  assert(
    /^\/[\w./-]+$/.test(binary),
    "The ELF path contains unsupported characters for a uprobe",
  );
  const addresses = symbolAddresses(binary);
  for (const name of required.filter((name) => name !== "stdout")) {
    assert(
      addresses.some(([stage]) => stage === name),
      "Missing symbol for required span " + name,
    );
  }
  const clauses = addresses.flatMap(([name, symbol]) => {
    const key =
      name === "bundle-load-and-parse"
        ? "@load"
        : name === "main"
          ? "@active"
          : null;
    return [
      `uprobe:${binary}:${symbol} /curtask->real_parent->tgid == ${process.pid}/ {
        ${key ? `${key}[tid] = 1;` : ""}
        printf("${name} begin %d %d %llu 0\\n", pid, tid, nsecs);
      }`,
      `uretprobe:${binary}:${symbol} /@active[tid]/ {
        printf("${name} end %d %d %llu 0\\n", pid, tid, nsecs);
        ${key === "@load" ? "delete(@load[tid]);" : ""}
      }`,
    ];
  });
  clauses.push(
    `uprobe:${binary}:_start /curtask->real_parent->tgid == ${process.pid}/ {
      printf("elf-entry at %d %d %llu 0\\n", pid, tid, nsecs);
    }`,
    `tracepoint:sched:sched_process_exec /curtask->real_parent->tgid == ${process.pid}/ {
      printf("exec at %d %d %llu 0\\n", pid, tid, nsecs);
    }`,
    `tracepoint:sched:sched_process_exit /@active[tid]/ {
      delete(@active[tid]);
      printf("exit at %d %d %llu %llu\\n", pid, tid, nsecs, curtask->se.sum_exec_runtime);
      @seen++;
      if (@seen == ${count}) { exit(); }
    }`,
    `tracepoint:syscalls:sys_enter_read /@load[tid]/ {
      @read[tid] = 1;
      printf("index-read begin %d %d %llu %llu\\n", pid, tid, nsecs, args->count);
    }`,
    `tracepoint:syscalls:sys_exit_read /@read[tid]/ {
      delete(@read[tid]); printf("index-read end %d %d %llu %ld\\n", pid, tid, nsecs, args->ret);
    }`,
    `tracepoint:syscalls:sys_enter_write /@active[tid] && args->fd == 1/ {
      @stdout[tid] = 1;
      printf("stdout begin %d %d %llu %llu\\n", pid, tid, nsecs, args->count);
    }`,
    `tracepoint:syscalls:sys_exit_write /@stdout[tid]/ {
      delete(@stdout[tid]); printf("stdout end %d %d %llu %ld\\n", pid, tid, nsecs, args->ret);
    }`,
    `interval:ms:100 /!@ready/ { @ready = 1; printf("ready\\n"); }`,
    `END { clear(@active); clear(@load); clear(@read); clear(@stdout); clear(@seen); clear(@ready); }`,
  );
  const path = join(directory, "trace.bt");
  writeFileSync(path, clauses.join("\n") + "\n", { mode: 0o600 });
  const tracer = spawn(
    "sudo",
    ["-n", "timeout", "30s", "bpftrace", "-q", "-B", "none", path],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  const ready = Promise.withResolvers<void>();
  tracer.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    if (stdout.includes("ready\n")) ready.resolve();
  });
  tracer.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    tracer.once("error", reject);
    tracer.once("close", resolve);
  });
  void closed.then(
    (status) =>
      ready.reject(
        new Error("Probe exited before readiness: " + status + " " + stderr),
      ),
    ready.reject,
  );
  let attempts: T[];
  try {
    await ready.promise;
    attempts = run();
  } finally {
    const status = await closed;
    writeFileSync(join(directory, "probe-events.txt"), stdout);
    writeFileSync(join(directory, "probe-stderr.txt"), stderr);
    assert.equal(status, 0, "bpftrace failed: " + stderr);
    assert(!/lost|dropped|error/i.test(stderr), stderr);
  }
  const marks: Mark[] = stdout.split("\n").flatMap((line) => {
    const match = line.match(
      /^([\w-]+) (begin|end|at) (\d+) (\d+) (\d+) (-?\d+)$/,
    );
    return match
      ? [
          {
            name: match[1],
            edge: match[2] as Mark["edge"],
            pid: Number(match[3]),
            tid: Number(match[4]),
            ns: BigInt(match[5]),
            bytes: Number(match[6]),
          },
        ]
      : [];
  });
  assert.equal(
    new Set(marks.filter(({ name }) => name === "main").map(({ pid }) => pid))
      .size,
    attempts.length,
  );
  return attempts.map((attempt) => ({
    ...attempt,
    trace: analyzeTrace(attempt, marks),
  }));
}
