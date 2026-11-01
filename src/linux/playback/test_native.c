/* SPDX-License-Identifier: MIT -- actual exported SPA factory/descriptor tests. */
#define _GNU_SOURCE
#include <assert.h>
#include <dlfcn.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <spa/utils/type.h>
#include "audio-plugin.h"
#include "lease.h"
struct child { pid_t pid; int input; };
static const char *helper;
static struct child start(const char *level) {
    int fds[2]; assert(pipe2(fds, O_CLOEXEC) == 0);
    pid_t pid = fork(); assert(pid >= 0);
    if (!pid) {
        assert(dup2(fds[0], STDIN_FILENO) == STDIN_FILENO);
        close(fds[0]); close(fds[1]);
        execl(helper, helper, "--serve", level, (char *)NULL); _exit(127);
    }
    close(fds[0]); return (struct child){ pid, fds[1] };
}
static void end(struct child c, int expected) {
    close(c.input); int status; assert(waitpid(c.pid, &status, 0) == c.pid);
    assert(WIFEXITED(status) && WEXITSTATUS(status) == expected);
}
static void check(const struct spa_fga_descriptor *d, void *s, float gain) {
    float in[] = { .125f, -.5f, 1.5f, 0.f }, out[4];
    d->connect_port(s, 0, in); d->connect_port(s, 1, out);
    for (unsigned block = 0; block < 32; block++) {
        d->run(s, 4);
        for (unsigned i = 0; i < 4; i++) assert(out[i] == in[i] * gain);
    }
    d->connect_port(s, 1, in); d->run(s, 4); // in-place buffers
    assert(in[1] == -.5f * gain);
}
int main(int argc, char **argv) {
    assert(argc == 3); helper = argv[2];
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!library) { fputs(dlerror(), stderr); return 2; }
    spa_handle_factory_enum_func_t enumerate = (spa_handle_factory_enum_func_t)dlsym(library, SPA_HANDLE_FACTORY_ENUM_FUNC_NAME);
    assert(enumerate);
    const struct spa_handle_factory *f; uint32_t index = 0;
    assert(enumerate(&f, &index) == 1);
    assert(!strcmp(f->name, "filter.graph.plugin.apparentlease"));
    assert(enumerate(&f, &index) == 0); index = 0; assert(enumerate(&f, &index) == 1);
    struct spa_handle *h = calloc(1, f->get_size(f, NULL)); assert(h);
    assert(f->init(f, h, NULL, NULL, 0) == 0);
    struct spa_fga_plugin *p = NULL;
    assert(h->get_interface(h, SPA_TYPE_INTERFACE_FILTER_GRAPH_AudioPlugin, (void **)&p) == 0);
    assert(!spa_fga_plugin_make_desc(p, "wrong"));
    const struct spa_fga_descriptor *d = spa_fga_plugin_make_desc(p, "lease_v1"); assert(d);
    assert(!d->instantiate(p, d, 48000, -1, NULL));
    assert(!d->instantiate(p, d, 48000, 2, NULL));
    void *left = d->instantiate(p, d, 48000, 0, NULL); assert(left);
    void *right = d->instantiate(p, d, 48000, 1, NULL); assert(right);
    d->activate(left); d->activate(right); check(d, left, 1.f); check(d, right, 1.f);
    LeaseMap m; assert(lease_open(&m) == 0); assert(flock(m.fd, LOCK_UN) == 0);
    struct stat original; assert(fstat(m.fd, &original) == 0);
    struct child c = start("20"); usleep(150000);
    check(d, left, .2f); check(d, right, .2f);
    struct child other = start("50"); end(other, 4); check(d, left, .2f);
    end(c, 0); check(d, left, 1.f); puts("normal EOF / singleton ownership / stereo: pass");
    for (int failure = 0; failure < 2; failure++) {
        c = start("20"); usleep(150000); check(d, left, .2f);
        assert(kill(c.pid, failure ? SIGKILL : SIGSTOP) == 0);
        usleep(850000); check(d, left, 1.f); check(d, right, 1.f);
        if (!failure) assert(kill(c.pid, SIGKILL) == 0);
        close(c.input); int status; assert(waitpid(c.pid, &status, 0) == c.pid); assert(WIFSIGNALED(status));
    }
    puts("SIGSTOP / SIGKILL independently expire: pass");
    c = start("0"); usleep(150000); check(d, left, 0.f); end(c, 0);
    c = start("100"); usleep(150000); check(d, left, 1.f); end(c, 0);
    c = start("101"); end(c, 2);
    c = start("-1"); end(c, 2);
    uint64_t now; assert(lease_now(&now) == 0);
    uint64_t malformed[] = {0, 1, UINT64_MAX, ((now + 5000) << 16) | 2000, ((now + 600) << 16) | 10001};
    for (unsigned i = 0; i < sizeof(malformed) / sizeof(*malformed); i++) {
        atomic_store(&m.slots[0], malformed[i]); check(d, left, 1.f);
    }
    atomic_store(&m.slots[0], 0);
    assert(flock(m.fd, LOCK_EX | LOCK_NB) == 0);
    void *contended = d->instantiate(p, d, 48000, 0, NULL); assert(contended);
    d->activate(contended); check(d, contended, 1.f); d->cleanup(contended);
    assert(flock(m.fd, LOCK_UN) == 0);
    struct stat after; assert(fstat(m.fd, &after) == 0);
    assert(after.st_ino == original.st_ino && after.st_size == original.st_size);
    d->deactivate(left); check(d, left, 1.f); d->activate(left);
    d->cleanup(left); d->cleanup(right);
    puts("levels / malformed leases / stable inode / valid-lock attachment: pass");
    /* No mapped processor remains before these destructive private fixtures. */
    assert(ftruncate(m.fd, 0) == 0); assert(flock(m.fd, LOCK_EX | LOCK_NB) == 0);
    uint64_t begin, finish; assert(lease_now(&begin) == 0);
    assert(!d->instantiate(p, d, 48000, 0, NULL));
    assert(lease_now(&finish) == 0 && finish - begin < 1000);
    assert(flock(m.fd, LOCK_UN) == 0); assert(ftruncate(m.fd, LEASE_BYTES) == 0);
    assert(fchmod(m.fd, 0644) == 0); assert(!d->instantiate(p, d, 48000, 0, NULL));
    assert(fchmod(m.fd, 0600) == 0);
    lease_close(&m);
    puts("uninitialized setup contention fails promptly / unsafe mode rejected: pass");
    assert(h->clear(h) == 0); free(h); dlclose(library);
    puts("actual native descriptor safety tests: PASS"); return 0;
}
