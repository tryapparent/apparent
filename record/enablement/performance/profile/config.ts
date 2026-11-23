export const durationMs = 25000;

export const profileConfig = `duration_ms: ${durationMs}
buffers { size_kb: 32768 fill_policy: DISCARD }
data_sources {
  config {
    name: "linux.perf"
    perf_event_config {
      timebase {
        counter: SW_CPU_CLOCK
        frequency: 99
        timestamp_clock: PERF_CLOCK_BOOTTIME
      }
      callstack_sampling { scope { target_cmdline: "apparent" } }
    }
  }
}
data_sources {
  config {
    name: "linux.ftrace"
    ftrace_config {
      ftrace_events: "sched/sched_switch"
      ftrace_events: "sched/sched_waking"
    }
  }
}
data_sources {
  config {
    name: "linux.process_stats"
    process_stats_config { scan_all_processes_on_start: true }
  }
}
`;
