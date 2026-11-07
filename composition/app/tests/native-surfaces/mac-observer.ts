import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Test-only, read-only observation of one supplied window and its process. */
export async function createMacWindowObserver(directory: string) {
  if (process.platform !== 'darwin') throw new Error('Mac native observation requires Darwin');
  const source = join(directory, 'window-observer.c');
  const executable = join(directory, 'window-observer');
  await writeFile(source, String.raw`
#define _DARWIN_C_SOURCE 1
#include <ApplicationServices/ApplicationServices.h>
#include <sys/sysctl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <limits.h>
#include <stdbool.h>

static int64_t start_microseconds(pid_t pid) {
  struct kinfo_proc info = {0};
  size_t length = sizeof(info);
  int mib[] = {CTL_KERN, KERN_PROC, KERN_PROC_PID, pid};
  if (sysctl(mib, 4, &info, &length, NULL, 0) || length != sizeof(info)
      || info.kp_proc.p_pid != pid) return -1;
  struct timeval start = info.kp_proc.p_un.__p_starttime;
  if (start.tv_sec <= 0 || start.tv_usec < 0 || start.tv_usec >= 1000000
      || start.tv_sec > (INT64_MAX - start.tv_usec) / 1000000) return -1;
  return (int64_t)start.tv_sec * 1000000 + start.tv_usec;
}

static uint64_t argument(const char *text, uint64_t maximum) {
  if (!text || text[0] < '1' || text[0] > '9') return 0;
  for (const char *p = text; *p; ++p) if (*p < '0' || *p > '9') return 0;
  char *end = NULL;
  errno = 0;
  unsigned long long value = strtoull(text, &end, 10);
  return errno || !end || *end || value > maximum ? 0 : value;
}

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  uint64_t parsed_pid = argument(argv[1], INT_MAX);
  uint64_t parsed_window = argument(argv[2], UINT32_MAX);
  if (!parsed_pid || !parsed_window) return 2;
  pid_t pid = (pid_t)parsed_pid;
  int64_t before = start_microseconds(pid);
  if (before <= 0 || before >= INT64_C(9007199254740991)) return 3;
  // Same integer Unix microseconds -> double milliseconds conversion as Electron.
  double milliseconds = (double)before / 1000.0;
  if (milliseconds == (double)(before - 1) / 1000.0
      || milliseconds == (double)(before + 1) / 1000.0) return 3;
  CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow,
      (CGWindowID)parsed_window);
  if (!windows) return 4;
  int found = 0;
  bool on_screen = false;
  for (CFIndex i = 0; i < CFArrayGetCount(windows); ++i) {
    CFDictionaryRef window = CFArrayGetValueAtIndex(windows, i);
    if (!window || CFGetTypeID(window) != CFDictionaryGetTypeID()) continue;
    CFNumberRef number = CFDictionaryGetValue(window, kCGWindowNumber);
    CFNumberRef owner = CFDictionaryGetValue(window, kCGWindowOwnerPID);
    int64_t window_id = 0, owner_pid = 0;
    if (!number || CFGetTypeID(number) != CFNumberGetTypeID()
        || !owner || CFGetTypeID(owner) != CFNumberGetTypeID()
        || !CFNumberGetValue(number, kCFNumberSInt64Type, &window_id)
        || !CFNumberGetValue(owner, kCFNumberSInt64Type, &owner_pid)
        || window_id != (int64_t)parsed_window || owner_pid != pid) continue;
    CFBooleanRef visible = CFDictionaryGetValue(window, kCGWindowIsOnscreen);
    if (!visible || CFGetTypeID(visible) != CFBooleanGetTypeID()) continue;
    on_screen = CFBooleanGetValue(visible);
    ++found;
  }
  CFRelease(windows);
  if (found != 1 || start_microseconds(pid) != before) return 4;
  printf("{\"pid\":%d,\"windowId\":%llu,\"creationTime\":%.17g,\"onScreen\":%s}\n",
      pid, (unsigned long long)parsed_window, milliseconds, on_screen ? "true" : "false");
  return 0;
}
`, { mode: 0o600 });
  await run('xcrun', ['clang', '-std=c11', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
    source, '-framework', 'ApplicationServices', '-o', executable], { timeout: 30_000 });
  return async (pid: number, windowId: number): Promise<{
    pid: number; windowId: number; creationTime: number; onScreen: boolean;
  }> => {
    const { stdout } = await run(executable, [String(pid), String(windowId)], { timeout: 5_000 });
    return JSON.parse(stdout);
  };
}
