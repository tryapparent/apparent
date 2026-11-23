export const durationMs = 25000;
export const laneDurationMs = 930000;
export const laneSizeLimit = 256 * 1024 * 1024;

const sampling = (processes: string[]) => `
data_sources {
  config {
    name: "linux.perf"
    perf_event_config {
      timebase {
        counter: SW_CPU_CLOCK
        frequency: 99
        timestamp_clock: PERF_CLOCK_BOOTTIME
      }
      callstack_sampling {
        scope { ${processes.map((name) => `target_cmdline: "${name}"`).join(" ")} }
      }
    }
  }
}
`;

const scheduling = `
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

export const profileConfig = `duration_ms: ${durationMs}
buffers { size_kb: 32768 fill_policy: DISCARD }${sampling(["apparent"])}${scheduling}`;

function lane(processes: string[], events: string) {
  return `duration_ms: ${laneDurationMs}
buffers { size_kb: 32768 fill_policy: RING_BUFFER }
write_into_file: true
file_write_period_ms: 1000
max_file_size_bytes: ${laneSizeLimit}${sampling(processes)}${events}`;
}

const desktop = ["apparent", "AppRun.wrapped", "electron", "ffmpeg", "ffprobe"];
export const guestProfileConfig = lane(
  [...desktop, "libbench.so.node", "Hyprland"],
  scheduling,
);
export const hostProfileConfig = lane(
  [
    ...desktop,
    "node",
    "chromium",
    "chrome",
    "chrome-headless-shell",
    "apparent_connect_client-*",
  ],
  "",
);
