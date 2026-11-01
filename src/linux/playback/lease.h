/* SPDX-License-Identifier: MIT
 * Linux-only per-user protocol. Never unlink, replace or shrink the leases inode.
 */
#ifndef APPARENT_LEASE_H
#define APPARENT_LEASE_H
#include <errno.h>
#include <fcntl.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/file.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define LEASE_SLOTS 64u
#define LEASE_BYTES 512u
#define LEASE_MAX_TTL_MS 1000u
#define LEASE_GAIN_ONE 10000u
#define LEASE_EXPIRY_MAX UINT64_C(0xffffffffffff)
_Static_assert(sizeof(_Atomic uint64_t) == 8, "protocol requires 8-byte atomics");
_Static_assert(_Alignof(_Atomic uint64_t) == 8, "protocol requires 8-byte alignment");
_Static_assert(ATOMIC_LLONG_LOCK_FREE == 2 && ATOMIC_LONG_LOCK_FREE == 2,
               "protocol requires always-lock-free 64-bit loads/stores");
typedef struct { int fd; _Atomic uint64_t *slots; } LeaseMap;

static inline int lease_now(uint64_t *ms) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0 || ts.tv_sec < 0) return -1;
    *ms = (uint64_t)ts.tv_sec * 1000u + (uint64_t)ts.tv_nsec / 1000000u;
    return *ms <= LEASE_EXPIRY_MAX - LEASE_MAX_TTL_MS ? 0 : -1;
}
static inline int lease_dir_ok(int fd) {
    struct stat s;
    return fstat(fd, &s) == 0 && S_ISDIR(s.st_mode) && s.st_uid == geteuid()
        && (s.st_mode & 0777) == 0700;
}
/* Setup only: may allocate, access filesystem and block. Returns a locked fd. */
static inline int lease_open_with_flags(LeaseMap *m, int lock_flags) {
    int root = -1, dir = -1, fd = -1;
    struct stat s;
    const char *runtime = getenv("XDG_RUNTIME_DIR");
    m->fd = -1; m->slots = NULL;
    if (!runtime || runtime[0] != '/') goto fail;
    root = open(runtime, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (root < 0 || !lease_dir_ok(root)) goto fail;
    if (mkdirat(root, "apparent-duck-v1", 0700) < 0 && errno != EEXIST) goto fail;
    dir = openat(root, "apparent-duck-v1", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (dir < 0 || !lease_dir_ok(dir)) goto fail;
    fd = openat(dir, "leases", O_RDWR | O_CREAT | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK, 0600);
    if (fd < 0 || fstat(fd, &s) < 0 || !S_ISREG(s.st_mode) || s.st_uid != geteuid()
        || (s.st_mode & 0777) != 0600 || s.st_nlink != 1) goto fail;
    if (flock(fd, lock_flags) < 0 || fstat(fd, &s) < 0) goto fail;
    /* Zero length is only the create/crash-before-initialization state.
     * Never shrink an existing file or reset valid live slots. */
    if (s.st_size == 0 && ftruncate(fd, LEASE_BYTES) < 0) goto fail;
    if (fstat(fd, &s) < 0 || s.st_size != LEASE_BYTES) goto fail;
    void *map = mmap(NULL, LEASE_BYTES, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) goto fail;
    m->fd = fd; m->slots = map;
    /* Read each page during setup, not first use in run(). This is not mlock. */
    for (unsigned i = 0; i < LEASE_SLOTS; ++i)
        (void)atomic_load_explicit(&m->slots[i], memory_order_relaxed);
    close(dir); close(root);
    return 0;
fail:
    if (fd >= 0) close(fd);
    if (dir >= 0) close(dir);
    if (root >= 0) close(root);
    return -1;
}
static inline int lease_open(LeaseMap *m) {
    return lease_open_with_flags(m, LOCK_EX);
}
/* Existing initialized inode: readers never need the publisher's setup lock.
 * No creation, resize or publication occurs here. Cooperative writers keep
 * this inode and its size stable for the lifetime of every mapped reader. */
static inline int lease_attach_readonly(LeaseMap *m) {
    int root = -1, dir = -1, fd = -1;
    struct stat s;
    const char *runtime = getenv("XDG_RUNTIME_DIR");
    m->fd = -1; m->slots = NULL;
    if (!runtime || runtime[0] != '/') goto fail;
    root = open(runtime, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (root < 0 || !lease_dir_ok(root)) goto fail;
    dir = openat(root, "apparent-duck-v1", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (dir < 0 || !lease_dir_ok(dir)) goto fail;
    fd = openat(dir, "leases", O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0 || fstat(fd, &s) < 0 || !S_ISREG(s.st_mode) || s.st_uid != geteuid()
        || (s.st_mode & 0777) != 0600 || s.st_nlink != 1 || s.st_size != LEASE_BYTES) goto fail;
    void *map = mmap(NULL, LEASE_BYTES, PROT_READ, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) goto fail;
    m->slots = map;
    for (unsigned i = 0; i < LEASE_SLOTS; ++i)
        (void)atomic_load_explicit(&m->slots[i], memory_order_relaxed);
    close(fd); close(dir); close(root);
    return 0;
fail:
    if (fd >= 0) close(fd);
    if (dir >= 0) close(dir);
    if (root >= 0) close(root);
    return -1;
}
static inline void lease_close(LeaseMap *m) {
    if (m->slots) munmap(m->slots, LEASE_BYTES);
    if (m->fd >= 0) close(m->fd);
    m->slots = NULL; m->fd = -1;
}
static inline int lease_valid(uint64_t w, uint64_t now) {
    uint64_t expiry = w >> 16;
    return (w & UINT64_C(65535)) <= LEASE_GAIN_ONE && expiry > now
        && expiry - now <= LEASE_MAX_TTL_MS;
}
/* One clock call, exactly 64 loads, no retries. Each word is self-contained. */
static inline float lease_gain(const LeaseMap *m) {
    uint64_t now;
    unsigned gain = LEASE_GAIN_ONE;
    if (!m->slots || lease_now(&now) != 0) return 1.0f;
    for (unsigned i = 0; i < LEASE_SLOTS; ++i) {
        uint64_t w = atomic_load_explicit(&m->slots[i], memory_order_relaxed);
        unsigned g = (unsigned)(w & UINT64_C(65535));
        if (lease_valid(w, now) && g < gain) gain = g;
    }
    return (float)gain / (float)LEASE_GAIN_ONE;
}
#endif
