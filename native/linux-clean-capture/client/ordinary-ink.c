/* Issue229 ordinary native ink bridge. Not a compositor/plugin or GPUI rewrite.
 * Build with the parent CMakeLists.txt. Parent runs only inside its isolated native test.
 * stdin: line x1 y1 x2 y2 | clear | quit. Physical feedback is this wl_surface.
 */
#define _GNU_SOURCE
#include <wayland-client.h>
#include "xdg-shell-client.h"
#include "apparent-clean-v1-client.h"
#include <glib-unix.h>
#include <gio/gunixfdlist.h>
#include <sys/mman.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <math.h>
#include "portal-client.h"

#define WIDTH 800
#define HEIGHT 400
static struct wl_display *display;
static struct wl_compositor *compositor;
static struct wl_shm *shm;
static struct xdg_wm_base *wm;
static struct apparent_clean_manager_v1 *manager;
static struct wl_surface *surface;
static struct xdg_surface *xdg;
static struct xdg_toplevel *toplevel;
static struct apparent_clean_role_v1 *role;
static GMainLoop *main_loop;
static int configured, capability = -1, denied;
static uint32_t pixels[WIDTH * HEIGHT];

struct frame { struct wl_buffer *buffer; void *map; size_t size; };
static void release(void *data, struct wl_buffer *buffer) {
    struct frame *f = data; wl_buffer_destroy(buffer); munmap(f->map, f->size); free(f);
}
static const struct wl_buffer_listener released = {release};
static void draw(void) {
    struct frame *f = calloc(1, sizeof(*f));
    f->size = sizeof(pixels);
    int fd = memfd_create("apparent-ordinary-ink-pixels", MFD_CLOEXEC);
    if (fd < 0 || ftruncate(fd, f->size)) abort();
    f->map = mmap(NULL, f->size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (f->map == MAP_FAILED) abort();
    memcpy(f->map, pixels, f->size);
    struct wl_shm_pool *pool = wl_shm_create_pool(shm, fd, f->size);
    f->buffer = wl_shm_pool_create_buffer(pool, 0, WIDTH, HEIGHT, WIDTH * 4, WL_SHM_FORMAT_ARGB8888);
    wl_shm_pool_destroy(pool); close(fd);
    wl_buffer_add_listener(f->buffer, &released, f);
    wl_surface_attach(surface, f->buffer, 0, 0);
    wl_surface_damage_buffer(surface, 0, 0, WIDTH, HEIGHT);
    wl_surface_commit(surface); wl_display_flush(display);
}
static void line(int x1, int y1, int x2, int y2) {
    /* Bounded rasterizer; premultiplied opaque red ink, transparent elsewhere. */
    if (x1 < -WIDTH*4 || x1 > WIDTH*4 || x2 < -WIDTH*4 || x2 > WIDTH*4 ||
        y1 < -HEIGHT*4 || y1 > HEIGHT*4 || y2 < -HEIGHT*4 || y2 > HEIGHT*4) return;
    int n = abs(x2-x1) + abs(y2-y1) + 1;
    for (int i=0; i<=n; ++i) {
        int x=x1+(x2-x1)*i/n, y=y1+(y2-y1)*i/n;
        for (int dy=-4;dy<=4;++dy) for (int dx=-4;dx<=4;++dx)
            if (x+dx>=0 && x+dx<WIDTH && y+dy>=0 && y+dy<HEIGHT && dx*dx+dy*dy<=16)
                pixels[(y+dy)*WIDTH+x+dx]=0xffff3028u;
    }
}
static void ping(void *d, struct xdg_wm_base *w, uint32_t serial) { (void)d; xdg_wm_base_pong(w, serial); }
static const struct xdg_wm_base_listener wm_listener = {ping};
static void configure(void *d, struct xdg_surface *s, uint32_t serial) { (void)d; xdg_surface_ack_configure(s, serial); configured=1; }
static const struct xdg_surface_listener configured_listener = {configure};
static void close_window(void *d, struct xdg_toplevel *t) { (void)d; (void)t; denied=1; if(main_loop)g_main_loop_quit(main_loop); }
static void top_configure(void *d, struct xdg_toplevel *t, int32_t w, int32_t h, struct wl_array *s) { (void)d;(void)t;(void)w;(void)h;(void)s; }
static void bounds(void*d,struct xdg_toplevel*t,int32_t w,int32_t h){(void)d;(void)t;(void)w;(void)h;}
static void capabilities(void*d,struct xdg_toplevel*t,struct wl_array*a){(void)d;(void)t;(void)a;}
static const struct xdg_toplevel_listener top_listener={top_configure,close_window,bounds,capabilities};
static void global(void *data, struct wl_registry *r, uint32_t name, const char *iface, uint32_t version) {
    (void)data;
    if (!strcmp(iface,"wl_compositor")) compositor=wl_registry_bind(r,name,&wl_compositor_interface,version<4?version:4);
    else if (!strcmp(iface,"wl_shm")) shm=wl_registry_bind(r,name,&wl_shm_interface,1);
    else if (!strcmp(iface,"xdg_wm_base")) { wm=wl_registry_bind(r,name,&xdg_wm_base_interface,1); xdg_wm_base_add_listener(wm,&wm_listener,NULL); }
    else if (!strcmp(iface,"apparent_clean_manager_v1")) manager=wl_registry_bind(r,name,&apparent_clean_manager_v1_interface,1);
}
static void removed(void*d,struct wl_registry*r,uint32_t n){(void)d;(void)r;(void)n;}
static const struct wl_registry_listener globals={global,removed};
static void role_capability(void *d, struct apparent_clean_role_v1 *r, int fd) {
    (void)d;(void)r;
    if(capability>=0){close(fd);denied=1;return;}
    capability=fd;
}
static void role_revoked(void*d,struct apparent_clean_role_v1*r){(void)d;(void)r;denied=1;if(main_loop)g_main_loop_quit(main_loop);}
static const struct apparent_clean_role_v1_listener role_listener={role_capability,role_revoked};
static gboolean wayland_ready(gint fd,GIOCondition c,gpointer data) {
    (void)fd;(void)data;
    if ((c&(G_IO_HUP|G_IO_ERR)) || wl_display_dispatch(display)<0) { denied=1;g_main_loop_quit(main_loop);return G_SOURCE_REMOVE; }
    wl_display_flush(display);return G_SOURCE_CONTINUE;
}
static gboolean input_ready(GIOChannel* channel,GIOCondition c,gpointer data) {
    (void)data; if(c&(G_IO_HUP|G_IO_ERR))return G_SOURCE_REMOVE;
    gchar *s=NULL;gsize size=0;
    if(g_io_channel_read_line(channel,&s,&size,NULL,NULL)!=G_IO_STATUS_NORMAL)return G_SOURCE_CONTINUE;
    int x1,y1,x2,y2;
    if(sscanf(s,"line %d %d %d %d",&x1,&y1,&x2,&y2)==4){line(x1,y1,x2,y2);draw();}
    else if(g_str_has_prefix(s,"clear")){memset(pixels,0,sizeof(pixels));draw();}
    else if(g_str_has_prefix(s,"quit"))g_main_loop_quit(main_loop);
    g_free(s);return G_SOURCE_CONTINUE;
}
int main(void) {
    display=wl_display_connect(NULL);
    if(!display){fprintf(stderr,"No native test Wayland connection\n");return 2;}
    struct wl_registry *registry=wl_display_get_registry(display);
    wl_registry_add_listener(registry,&globals,NULL);
    if(wl_display_roundtrip(display)<0 || !compositor || !shm || !wm || !manager){fprintf(stderr,"Required native clean protocol unavailable; no ordinary fallback\n");return 2;}
    surface=wl_compositor_create_surface(compositor);
    xdg=xdg_wm_base_get_xdg_surface(wm,surface);xdg_surface_add_listener(xdg,&configured_listener,NULL);
    toplevel=xdg_surface_get_toplevel(xdg);xdg_toplevel_add_listener(toplevel,&top_listener,NULL);
    xdg_toplevel_set_app_id(toplevel,"apparent-clean-ordinary-ink");
    xdg_toplevel_set_title(toplevel,"Apparent ordinary ink — clean producer proof");
    wl_surface_commit(surface);
    while(!configured && !denied)if(wl_display_dispatch(display)<0)return 2;
    line(70,80,600,300);draw();
    if(wl_display_roundtrip(display)<0)return 2;
    role=apparent_clean_manager_v1_register_surface(manager,surface);
    apparent_clean_role_v1_add_listener(role,&role_listener,NULL);
    if(wl_display_roundtrip(display)<0 || denied || capability<0){fprintf(stderr,"Native ordinary surface role denied\n");return 2;}
    main_loop=g_main_loop_new(NULL,FALSE);
    g_unix_fd_add(wl_display_get_fd(display),G_IO_IN|G_IO_HUP|G_IO_ERR,wayland_ready,NULL);
    GIOChannel *input=g_io_channel_unix_new(STDIN_FILENO);
    g_io_add_watch(input,G_IO_IN|G_IO_HUP|G_IO_ERR,input_ready,NULL);
    /* The FD is a surface capability, never permission. Portal UI must still
     * authorize the original Screen/Area source on this real portal session. */
    struct apparent_portal_client *client=apparent_portal_client_start(capability,main_loop);
    close(capability);capability=-1;
    if(!client){fprintf(stderr,"Authorized clean stream failed; no ordinary fallback\n");return 2;}
    g_main_loop_run(main_loop);
    gboolean stream_ok=apparent_portal_client_ok(client);
    apparent_portal_client_stop(client);
    apparent_clean_role_v1_destroy(role);xdg_toplevel_destroy(toplevel);xdg_surface_destroy(xdg);wl_surface_destroy(surface);
    wl_display_flush(display);wl_display_disconnect(display);
    g_io_channel_unref(input);g_main_loop_unref(main_loop);
    return denied || !stream_ok ? 2 : 0;
}
