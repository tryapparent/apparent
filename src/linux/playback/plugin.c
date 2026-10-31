/* SPDX-License-Identifier: MIT
 * Restricted to PipeWire 1.6.9's native FGA ABI and mono/stereo playback.
 * No runtime availability claims, counters or writable receipt mappings.
 */
#define _GNU_SOURCE
#include <string.h>
#include <spa/utils/type.h>
#include "audio-plugin.h"
#include "lease.h"
struct plugin { struct spa_handle handle; struct spa_fga_plugin plugin; };
struct instance { float *in, *out; unsigned active; LeaseMap leases; };
static void *instantiate(const struct spa_fga_plugin *api, const struct spa_fga_descriptor *desc,
                        unsigned long rate, int index, const char *config) {
    (void)api; (void)desc; (void)rate; (void)config;
    if (index < 0 || index > 1) return NULL;
    struct instance *s = calloc(1, sizeof(*s));
    if (!s) return NULL;
    s->leases.fd = -1;
    if (lease_attach_readonly(&s->leases) < 0) {
        /* Setup only. Never wait behind another initializer. A failed mapping
         * rejects construction; run() never retries or pretends it is healthy. */
        if (lease_open_with_flags(&s->leases, LOCK_EX | LOCK_NB) < 0) { free(s); return NULL; }
        (void)flock(s->leases.fd, LOCK_UN);
        close(s->leases.fd); s->leases.fd = -1;
    }
    return s;
}
static void connect_port(void *handle, unsigned long port, void *data) {
    struct instance *s = handle;
    if (port == 0) s->in = data;
    if (port == 1) s->out = data;
}
static void activate(void *handle) { ((struct instance *)handle)->active = 1; }
static void deactivate(void *handle) { ((struct instance *)handle)->active = 0; }
static void run(void *handle, unsigned long n) {
    struct instance *s = handle;
    if (!s->out) return;
    float gain = s->active ? lease_gain(&s->leases) : 1.f;
    /* Internal links legitimately remain connected across callbacks. */
    for (unsigned long i = 0; i < n; i++) s->out[i] = s->in ? s->in[i] * gain : 0.f;
}
static void cleanup(void *handle) {
    struct instance *s = handle; lease_close(&s->leases); free(s);
}
static struct spa_fga_port ports[] = {
    { .index = 0, .name = "In", .flags = SPA_FGA_PORT_INPUT | SPA_FGA_PORT_AUDIO },
    { .index = 1, .name = "Out", .flags = SPA_FGA_PORT_OUTPUT | SPA_FGA_PORT_AUDIO }
};
static const struct spa_fga_descriptor descriptor = { .name = "lease_v1", .n_ports = 2, .ports = ports,
    .instantiate = instantiate, .cleanup = cleanup, .connect_port = connect_port,
    .activate = activate, .deactivate = deactivate, .run = run };
static const struct spa_fga_descriptor *make_desc(void *p, const char *name) {
    (void)p; return !strcmp(name, descriptor.name) ? &descriptor : NULL;
}
static const struct spa_fga_plugin_methods methods = { .version = SPA_VERSION_FGA_PLUGIN_METHODS, .make_desc = make_desc };
static int get_interface(struct spa_handle *h, const char *type, void **out) {
    if (!h || !out) return -EINVAL;
    if (strcmp(type, SPA_TYPE_INTERFACE_FILTER_GRAPH_AudioPlugin)) return -ENOENT;
    *out = &((struct plugin *)h)->plugin; return 0;
}
static int clear(struct spa_handle *h) { (void)h; return 0; }
static size_t get_size(const struct spa_handle_factory *f, const struct spa_dict *d) {
    (void)f; (void)d; return sizeof(struct plugin);
}
static int init(const struct spa_handle_factory *f, struct spa_handle *h, const struct spa_dict *info,
                const struct spa_support *support, uint32_t n) {
    (void)f; (void)info; (void)support; (void)n;
    h->get_interface = get_interface; h->clear = clear;
    struct plugin *p = (struct plugin *)h;
    p->plugin.iface = SPA_INTERFACE_INIT(SPA_TYPE_INTERFACE_FILTER_GRAPH_AudioPlugin, SPA_VERSION_FGA_PLUGIN, &methods, p);
    return 0;
}
static int interfaces(const struct spa_handle_factory *f, const struct spa_interface_info **out, uint32_t *index) {
    (void)f; static const struct spa_interface_info i = { SPA_TYPE_INTERFACE_FILTER_GRAPH_AudioPlugin };
    if (!out || !index) return -EINVAL;
    if ((*index)++) return 0;
    *out = &i; return 1;
}
static const struct spa_handle_factory factory = { .version = SPA_VERSION_HANDLE_FACTORY,
    .name = "filter.graph.plugin.apparentlease", .get_size = get_size, .init = init, .enum_interface_info = interfaces };
SPA_EXPORT int spa_handle_factory_enum(const struct spa_handle_factory **out, uint32_t *index) {
    if (!out || !index) return -EINVAL;
    if ((*index)++) return 0;
    *out = &factory; return 1;
}
