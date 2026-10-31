/* SPDX-License-Identifier: MIT
 * One capture per user. Stdin EOF/stop clears our word; a stopped or killed
 * helper cannot renew it, so every mapped processor independently returns unity.
 */
#define _GNU_SOURCE
#include "lease.h"
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
static volatile sig_atomic_t stopped;
static void stop_signal(int sig) { (void)sig; stopped = 1; }
static int percent(const char *s, unsigned *out) {
    unsigned n = 0;
    if (!*s) return -1;
    for (; *s; s++) {
        if (*s < '0' || *s > '9' || n > 100) return -1;
        n = n * 10 + (unsigned)(*s - '0');
    }
    if (n > 100) return -1;
    *out = n; return 0;
}
int main(int argc, char **argv) {
    unsigned level = 100;
    int init = argc == 2 && !strcmp(argv[1], "--init");
    if (!init && (argc != 3 || strcmp(argv[1], "--serve") || percent(argv[2], &level))) {
        fputs("usage: apparent-playback-helper --init | --serve PERCENT_0_TO_100\n", stderr);
        return 2;
    }
    LeaseMap m;
    if (lease_open_with_flags(&m, LOCK_EX | LOCK_NB) < 0) {
        fputs("Playback lease state is unsafe, unavailable or busy\n", stderr); return 3;
    }
    if (init) { lease_close(&m); return 0; }
    struct flock lock = { .l_type = F_WRLCK, .l_whence = SEEK_SET, .l_start = 0, .l_len = 1 };
    if (fcntl(m.fd, F_OFD_SETLK, &lock) < 0) {
        fputs("Another playback capture helper owns this session\n", stderr);
        lease_close(&m); return 4;
    }
    /* The OFD lock, not a PID or expiry timestamp, owns this capture slot.
     * A suspended helper keeps ownership; a dead helper's old word can be replaced. */
    if (flock(m.fd, LOCK_UN) < 0) { lease_close(&m); return 3; }
    struct sigaction action = { .sa_handler = stop_signal };
    sigemptyset(&action.sa_mask);
    if (sigaction(SIGTERM, &action, NULL) || sigaction(SIGINT, &action, NULL)) {
        lease_close(&m); return 3;
    }
    int result = 0;
    while (!stopped) {
        uint64_t now;
        if (lease_now(&now)) { result = 3; break; }
        atomic_store_explicit(&m.slots[0], ((now + 600) << 16) | (level * 100), memory_order_relaxed);
        struct pollfd input = { .fd = STDIN_FILENO, .events = POLLIN };
        int event = poll(&input, 1, 200);
        if (event < 0) {
            if (errno == EINTR) continue;
            result = 3; break;
        }
        /* Any input, EOF, closed/invalid stdin or TERM ends this capture. */
        if (event > 0) break;
    }
    atomic_store_explicit(&m.slots[0], 0, memory_order_relaxed);
    lease_close(&m);
    return result;
}
