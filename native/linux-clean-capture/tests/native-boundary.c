/* In-process generated Wayland transport + PRODUCTION receipt validator test.
 * Fixture events are NOT portal authority or renderer/native acceptance.
 * No compositor, session bus service, desktop, VM, or plugin is started.
 */
#define _GNU_SOURCE
#include <assert.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <unistd.h>
#include <wayland-client.h>
#include <wayland-server.h>
#include "apparent-clean-v1-client.h"
#include "apparent-clean-v1-server.h"
#include "apparent-clean-receipt-validate.h"
#include "wlr-screencopy-unstable-v1-client.h"
#include "wlr-screencopy-unstable-v1-server.h"

static struct wl_display *server;
static atomic_bool stopping;
static struct wl_compositor *compositor;
static struct zwlr_screencopy_manager_v1 *screencopy;
static struct apparent_clean_manager_v1 *manager;
static unsigned callbacks;
static unsigned expected_callbacks;
static uint32_t expected_portal, expected_sequence, expected_generation, expected_frame;
static uint32_t expected_buffer;
static struct wl_shm *shm;
static void destroy(struct wl_client*,struct wl_resource*);
struct pool {void *map;size_t size;};
static void pool_free(struct wl_resource*r){struct pool*p=wl_resource_get_user_data(r);munmap(p->map,p->size);free(p);}
static void pool_buffer(struct wl_client*c,struct wl_resource*r,uint32_t id,int32_t offset,int32_t w,int32_t h,int32_t stride,uint32_t format){
    (void)w;(void)h;(void)stride;(void)format;struct pool*p=wl_resource_get_user_data(r);
    struct wl_resource*b=wl_resource_create(c,&wl_buffer_interface,1,id);
    static const struct wl_buffer_interface impl={destroy};
    wl_resource_set_implementation(b,&impl,(char*)p->map+offset,NULL);
}
static const struct wl_shm_pool_interface pool_impl={.create_buffer=pool_buffer,.destroy=destroy};
static void create_pool(struct wl_client*c,struct wl_resource*r,uint32_t id,int fd,int32_t size){
    (void)r;struct pool*p=calloc(1,sizeof(*p));p->size=size;p->map=mmap(NULL,size,PROT_READ|PROT_WRITE,MAP_SHARED,fd,0);close(fd);assert(p->map!=MAP_FAILED);
    struct wl_resource*res=wl_resource_create(c,&wl_shm_pool_interface,1,id);wl_resource_set_implementation(res,&pool_impl,p,pool_free);
}
static const struct wl_shm_interface shm_impl={create_pool};
static void shm_bind(struct wl_client*c,void*d,uint32_t v,uint32_t id){(void)d;(void)v;struct wl_resource*r=wl_resource_create(c,&wl_shm_interface,1,id);wl_resource_set_implementation(r,&shm_impl,NULL,NULL);wl_shm_send_format(r,WL_SHM_FORMAT_XRGB8888);}
static void destroy(struct wl_client*c,struct wl_resource*r){(void)c;wl_resource_destroy(r);}
static void surface_commit(struct wl_client*c,struct wl_resource*r){(void)c;(void)r;}
static const struct wl_surface_interface surface_impl={.destroy=destroy,.commit=surface_commit};
static void surface_create(struct wl_client*c,struct wl_resource*r,uint32_t id){
    (void)r;struct wl_resource*s=wl_resource_create(c,&wl_surface_interface,1,id);wl_resource_set_implementation(s,&surface_impl,NULL,NULL);
}
static const struct wl_compositor_interface compositor_impl={.create_surface=surface_create};
static void compositor_bind(struct wl_client*c,void*d,uint32_t v,uint32_t id){(void)d;(void)v;struct wl_resource*r=wl_resource_create(c,&wl_compositor_interface,1,id);wl_resource_set_implementation(r,&compositor_impl,NULL,NULL);}
struct frame_state {struct wl_resource*sample;uint32_t portal,sequence,generation;};
static void frame_copy(struct wl_client*,struct wl_resource*,struct wl_resource*);
static void frame_free(struct wl_resource*r){free(wl_resource_get_user_data(r));}
static const struct zwlr_screencopy_frame_v1_interface frame_impl={.copy=frame_copy,.destroy=destroy,.copy_with_damage=frame_copy};
static void capture(struct wl_client*c,struct wl_resource*r,uint32_t id,int32_t cursor,struct wl_resource*output){
    (void)r;(void)cursor;(void)output;struct wl_resource*f=wl_resource_create(c,&zwlr_screencopy_frame_v1_interface,3,id);wl_resource_set_implementation(f,&frame_impl,calloc(1,sizeof(struct frame_state)),frame_free);
}
static const struct zwlr_screencopy_manager_v1_interface capture_impl={.capture_output=capture,.destroy=destroy};
static void screencopy_bind(struct wl_client*c,void*d,uint32_t v,uint32_t id){(void)d;(void)v;struct wl_resource*r=wl_resource_create(c,&zwlr_screencopy_manager_v1_interface,3,id);wl_resource_set_implementation(r,&capture_impl,NULL,NULL);}
static const struct apparent_clean_sample_v1_interface sample_impl={destroy};
static void attach(struct wl_client*c,struct wl_resource*r,uint32_t id,struct wl_resource*frame,uint32_t seq,uint32_t gen){
    struct wl_resource*s=wl_resource_create(c,&apparent_clean_sample_v1_interface,1,id);wl_resource_set_implementation(s,&sample_impl,NULL,NULL);
    assert(!strcmp(wl_resource_get_class(frame),"zwlr_screencopy_frame_v1"));
    struct frame_state*f=wl_resource_get_user_data(frame);assert(!f->sample);
    *f=(struct frame_state){s,(uint32_t)(uintptr_t)wl_resource_get_user_data(r),seq,gen};
}
static void frame_copy(struct wl_client*c,struct wl_resource*frame,struct wl_resource*buffer){
    (void)c;struct frame_state*f=wl_resource_get_user_data(frame);assert(f->sample);
    /* Test pixels flow through the actual mapped wl_buffer resource, not an
     * invented buffer ID. These pixels are fixtures, never scene evidence. */
    *(uint32_t*)wl_resource_get_user_data(buffer)=f->sequence;
    struct apparent_clean_receipt_v1 receipt={.magic=APPARENT_CLEAN_MAGIC,.version=1,.size=sizeof(receipt),.portal=f->portal,
        .sequence=f->sequence,.source_generation=7,.buffer_generation=f->generation,.frame_id=wl_resource_get_id(frame),.buffer_id=wl_resource_get_id(buffer),
        .role_serial=9,.surface_id=10,.width=128,.height=72,.output_width=128,.output_height=72,.scale=1.0};
    int fd=memfd_create("generated-boundary-fixture-not-authority",MFD_CLOEXEC|MFD_ALLOW_SEALING);assert(fd>=0);
    assert(write(fd,&receipt,sizeof(receipt))==sizeof(receipt));
    assert(fcntl(fd,F_ADD_SEALS,F_SEAL_WRITE|F_SEAL_SHRINK|F_SEAL_GROW|F_SEAL_SEAL)==0);
    apparent_clean_sample_v1_send_receipt(f->sample,fd);close(fd);zwlr_screencopy_frame_v1_send_ready(frame,0,0,f->sequence);
}
static const struct apparent_clean_grant_v1_interface grant_impl={destroy,attach};
static void authorize(struct wl_client*c,struct wl_resource*r,uint32_t id,int fd,struct wl_resource*o,int32_t x,int32_t y,int32_t w,int32_t h,uint32_t cursor){
    (void)r;(void)o;(void)x;(void)y;(void)w;(void)h;(void)cursor;close(fd);
    static uint32_t next=100;
    struct wl_resource*g=wl_resource_create(c,&apparent_clean_grant_v1_interface,1,id);
    wl_resource_set_implementation(g,&grant_impl,(void*)(uintptr_t)++next,NULL);apparent_clean_grant_v1_send_authorized(g,next);
}
static void register_surface(struct wl_client*c,struct wl_resource*r,uint32_t id,struct wl_resource*s){(void)c;(void)r;(void)id;(void)s;assert(0);}
static const struct apparent_clean_manager_v1_interface manager_impl={destroy,register_surface,authorize};
static void manager_bind(struct wl_client*c,void*d,uint32_t v,uint32_t id){(void)d;(void)v;struct wl_resource*r=wl_resource_create(c,&apparent_clean_manager_v1_interface,1,id);wl_resource_set_implementation(r,&manager_impl,NULL,NULL);}
static void output_bind(struct wl_client*c,void*d,uint32_t v,uint32_t id){(void)d;(void)v;wl_resource_create(c,&wl_output_interface,1,id);}
static struct wl_output *output;
static void global(void*d,struct wl_registry*r,uint32_t n,const char*i,uint32_t v){
    (void)d;(void)v;
    if(!strcmp(i,"wl_compositor"))compositor=wl_registry_bind(r,n,&wl_compositor_interface,1);
    if(!strcmp(i,"wl_shm"))shm=wl_registry_bind(r,n,&wl_shm_interface,1);
    if(!strcmp(i,"wl_output"))output=wl_registry_bind(r,n,&wl_output_interface,1);
    if(!strcmp(i,"zwlr_screencopy_manager_v1"))screencopy=wl_registry_bind(r,n,&zwlr_screencopy_manager_v1_interface,3);
    if(!strcmp(i,"apparent_clean_manager_v1"))manager=wl_registry_bind(r,n,&apparent_clean_manager_v1_interface,1);
}
static void removed(void*d,struct wl_registry*r,uint32_t n){(void)d;(void)r;(void)n;}
static const struct wl_registry_listener globals={global,removed};
static void authorized(void*d,struct apparent_clean_grant_v1*g,uint32_t portal){(void)g;*(uint32_t*)d=portal;}
static void revoked(void*d,struct apparent_clean_grant_v1*g){(void)d;(void)g;assert(0);}
static const struct apparent_clean_grant_v1_listener grant_listener={authorized,revoked};
static void receipt(void*d,struct apparent_clean_sample_v1*s,int fd){
    (void)d;(void)s;struct apparent_clean_receipt_v1 r;
    assert(apparent_clean_read_receipt_v1(fd,expected_portal,expected_sequence,expected_generation,expected_frame,expected_buffer,&r));
    assert(!apparent_clean_read_receipt_v1(fd,expected_portal+1,expected_sequence,expected_generation,expected_frame,expected_buffer,&r));
    assert(!apparent_clean_read_receipt_v1(fd,expected_portal,expected_sequence+1,expected_generation,expected_frame,expected_buffer,&r));
    assert(!apparent_clean_read_receipt_v1(fd,expected_portal,expected_sequence,expected_generation+1,expected_frame,expected_buffer,&r));
    assert(!apparent_clean_read_receipt_v1(fd,expected_portal,expected_sequence,expected_generation,expected_frame+1,expected_buffer,&r));
    assert(!apparent_clean_read_receipt_v1(fd,expected_portal,expected_sequence,expected_generation,expected_frame,expected_buffer+1,&r));
    close(fd);callbacks++;
}
static void failed(void*d,struct apparent_clean_sample_v1*s){(void)d;(void)s;assert(0);}
static const struct apparent_clean_sample_v1_listener sample_listener={receipt,failed};
static void frame_ready(void*d,struct zwlr_screencopy_frame_v1*f,uint32_t hi,uint32_t lo,uint32_t ns){(void)d;(void)f;(void)hi;(void)lo;(void)ns;assert(callbacks==expected_callbacks);}
static const struct zwlr_screencopy_frame_v1_listener frame_listener={.ready=frame_ready};
static void *serve(void*d){(void)d;while(!atomic_load(&stopping)){wl_event_loop_dispatch(wl_display_get_event_loop(server),5);wl_display_flush_clients(server);}return NULL;}
int main(void){
    server=wl_display_create();assert(server);
    wl_global_create(server,&wl_compositor_interface,1,NULL,compositor_bind);
    wl_global_create(server,&wl_shm_interface,1,NULL,shm_bind);
    wl_global_create(server,&wl_output_interface,1,NULL,output_bind);
    wl_global_create(server,&zwlr_screencopy_manager_v1_interface,3,NULL,screencopy_bind);
    wl_global_create(server,&apparent_clean_manager_v1_interface,1,NULL,manager_bind);
    int fds[2];assert(socketpair(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0,fds)==0);assert(wl_client_create(server,fds[0]));
    pthread_t thread;assert(!pthread_create(&thread,NULL,serve,NULL));
    struct wl_display*client=wl_display_connect_to_fd(fds[1]);assert(client);
    struct wl_registry*registry=wl_display_get_registry(client);wl_registry_add_listener(registry,&globals,NULL);assert(wl_display_roundtrip(client)>=0);
    struct wl_surface*surface=wl_compositor_create_surface(compositor);wl_surface_commit(surface);
    int pixel_fd=memfd_create("transport-test-pixels-not-scene",MFD_CLOEXEC);assert(pixel_fd>=0);assert(ftruncate(pixel_fd,4096)==0);
    uint32_t*pixel=mmap(NULL,4096,PROT_READ|PROT_WRITE,MAP_SHARED,pixel_fd,0);assert(pixel!=MAP_FAILED);
    struct wl_shm_pool*pool=wl_shm_create_pool(shm,pixel_fd,4096);close(pixel_fd);
    struct wl_buffer*buffer=wl_shm_pool_create_buffer(pool,0,1,1,4,WL_SHM_FORMAT_XRGB8888);expected_buffer=wl_proxy_get_id((struct wl_proxy*)buffer);
    int cap[2];assert(pipe(cap)==0);
    struct apparent_clean_grant_v1*a=apparent_clean_manager_v1_authorize(manager,cap[0],output,0,0,0,0,0);
    struct apparent_clean_grant_v1*b=apparent_clean_manager_v1_authorize(manager,cap[0],output,0,0,0,0,0);
    close(cap[0]);close(cap[1]);uint32_t pa=0,pb=0;
    apparent_clean_grant_v1_add_listener(a,&grant_listener,&pa);apparent_clean_grant_v1_add_listener(b,&grant_listener,&pb);assert(wl_display_roundtrip(client)>=0);assert(pa&&pb&&pa!=pb);
    /* Interleaved same-source original requests: each real native frame and
     * grant gets its own transport identity. This is NOT scene rendering. */
    for(unsigned i=0;i<12;++i){
        expected_callbacks=i+1;
        struct zwlr_screencopy_frame_v1*f=zwlr_screencopy_manager_v1_capture_output(screencopy,0,output);
        zwlr_screencopy_frame_v1_add_listener(f,&frame_listener,NULL);
        expected_portal=i%2?pa:pb;expected_sequence=i/2+1;expected_generation=i+1;expected_frame=wl_proxy_get_id((struct wl_proxy*)f);
        struct apparent_clean_sample_v1*s=apparent_clean_grant_v1_attach(i%2?a:b,f,expected_sequence,expected_generation);
        apparent_clean_sample_v1_add_listener(s,&sample_listener,NULL);zwlr_screencopy_frame_v1_copy_with_damage(f,buffer);assert(wl_display_roundtrip(client)>=0);assert(*pixel==expected_sequence);
        apparent_clean_sample_v1_destroy(s);zwlr_screencopy_frame_v1_destroy(f);
    }
    assert(callbacks==12);
    int unsealed=memfd_create("invalid",MFD_CLOEXEC|MFD_ALLOW_SEALING);assert(unsealed>=0);struct apparent_clean_receipt_v1 r={0};
    assert(!apparent_clean_read_receipt_v1(unsealed,pa,1,1,1,1,&r));close(unsealed);
    apparent_clean_grant_v1_destroy(a);apparent_clean_grant_v1_destroy(b);apparent_clean_manager_v1_destroy(manager);
    wl_buffer_destroy(buffer);wl_shm_pool_destroy(pool);munmap(pixel,4096);
    assert(wl_display_roundtrip(client)>=0);wl_display_disconnect(client);
    atomic_store(&stopping,true);pthread_join(thread,NULL);wl_display_destroy_clients(server);wl_display_destroy(server);
    puts("PASS generated Wayland transport: 12 interleaved native frame/FD samples; production receipt validator rejects portal/sequence/generation/frame/buffer mismatch and unsealed record. NOT portal authorization/render/native acceptance.");
}
