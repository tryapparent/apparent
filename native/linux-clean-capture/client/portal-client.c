/* Runnable, private issue229 portal/PipeWire adapter. No fake authority path. */
#define _GNU_SOURCE
#include "portal-client.h"
#include "apparent-clean-receipt.h"
#include <gio/gunixfdlist.h>
#include <glib-unix.h>
#include <pipewire/pipewire.h>
#include <spa/param/video/format-utils.h>
#include <spa/buffer/meta.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>

struct apparent_portal_client {
    GDBusConnection *bus;
    char *session;
    GMainLoop *main_loop;
    struct pw_loop *pwloop;
    struct pw_context *context;
    struct pw_core *core;
    struct pw_stream *stream;
    struct spa_hook listener;
    guint source, closed;
    uint64_t sequence;
    uint32_t portal;
    gboolean failed;
};
struct response {GMainLoop *loop; GVariant *results; guint code; gboolean complete;};
static void response_cb(GDBusConnection*b,const gchar*s,const gchar*p,const gchar*i,const gchar*m,GVariant*v,gpointer data) {
    (void)b;(void)s;(void)p;(void)i;(void)m;
    struct response *r=data;
    g_variant_get(v,"(u@a{sv})",&r->code,&r->results); r->complete=TRUE;g_main_loop_quit(r->loop);
}
static gboolean timeout_cb(gpointer data){g_main_loop_quit(((struct response*)data)->loop);return G_SOURCE_REMOVE;}
static GVariant *request(struct apparent_portal_client *c,const char *method,GVariant *args,int fd,const char *token) {
    const char *unique=g_dbus_connection_get_unique_name(c->bus);
    char *sender=g_strdup(unique+1);for(char*p=sender;*p;++p)if(*p=='.')*p='_';
    char *path=g_strdup_printf("/org/freedesktop/portal/desktop/request/%s/%s",sender,token);g_free(sender);
    struct response r={.loop=g_main_loop_new(NULL,FALSE),.code=2};
    guint subscription=g_dbus_connection_signal_subscribe(c->bus,"org.freedesktop.portal.Desktop","org.freedesktop.portal.Request","Response",path,NULL,G_DBUS_SIGNAL_FLAGS_NONE,response_cb,&r,NULL);
    GUnixFDList *fds=NULL;
    if(fd>=0){fds=g_unix_fd_list_new();if(g_unix_fd_list_append(fds,fd,NULL)<0)goto done;}
    GError *error=NULL;
    GVariant *reply=g_dbus_connection_call_with_unix_fd_list_sync(c->bus,"org.freedesktop.portal.Desktop","/org/freedesktop/portal/desktop","org.freedesktop.portal.ScreenCast",method,args,G_VARIANT_TYPE("(o)"),G_DBUS_CALL_FLAGS_NONE,30000,fds,NULL,NULL,&error);
    if(!reply){fprintf(stderr,"%s: %s\n",method,error?error->message:"failed");g_clear_error(&error);goto done;}
    const char *actual=NULL;g_variant_get(reply,"(&o)",&actual);
    gboolean exact=!strcmp(actual,path);g_variant_unref(reply);if(!exact)goto done;
    guint timeout=g_timeout_add_seconds(120,timeout_cb,&r);
    if(!r.complete)g_main_loop_run(r.loop);
    if(r.complete)g_source_remove(timeout);
 done:
    if(fds)g_object_unref(fds);
    g_dbus_connection_signal_unsubscribe(c->bus,subscription);g_main_loop_unref(r.loop);g_free(path);
    if(!r.complete || r.code){if(r.results)g_variant_unref(r.results);return NULL;}
    return r.results;
}
static void session_closed(GDBusConnection*b,const gchar*s,const gchar*p,const gchar*i,const gchar*m,GVariant*v,gpointer data){
    (void)b;(void)s;(void)p;(void)i;(void)m;(void)v;
    struct apparent_portal_client*c=data;c->failed=TRUE;g_main_loop_quit(c->main_loop);
}
static void process(void *data) {
    struct apparent_portal_client*c=data;
    struct pw_buffer *b;
    while((b=pw_stream_dequeue_buffer(c->stream))) {
        struct spa_buffer *buffer=b->buffer;
        const struct apparent_clean_receipt_v1 *r=spa_buffer_find_meta_data(buffer,APPARENT_CLEAN_META_TYPE,sizeof(*r));
        if(!r || r->magic!=APPARENT_CLEAN_MAGIC || r->version!=1 || r->size!=sizeof(*r) || !r->portal ||
            !r->frame_id || !r->buffer_id || !r->source_generation || !r->buffer_generation || !r->role_serial || !r->surface_id ||
            r->sequence!=c->sequence+1 || (c->portal && r->portal!=c->portal) ||
            r->width<=0 || r->height<=0 || r->transform!=0 || r->scale!=1.0 || !buffer->n_datas || !buffer->datas[0].data || !buffer->datas[0].chunk) {
            fprintf(stderr,"FAIL: buffer/receipt missing or stale; no ordinary fallback\n");
            c->failed=TRUE;
            pw_stream_set_active(c->stream,FALSE);g_main_loop_quit(c->main_loop);return;
        }
        c->portal=r->portal;c->sequence=r->sequence;
        const struct spa_data *d=&buffer->datas[0];
        if(d->chunk->offset>d->maxsize || d->chunk->size>d->maxsize-d->chunk->offset ||
            d->chunk->stride < (int64_t)r->width*4 || d->chunk->size < (uint64_t)d->chunk->stride*r->height) {
            c->failed=TRUE;g_main_loop_quit(c->main_loop);return;
        }
        const unsigned char *bytes=(const unsigned char*)d->data+d->chunk->offset;
        uint64_t hash=1469598103934665603ULL;
        for(uint32_t j=0;j<d->chunk->size;++j){hash^=bytes[j];hash*=1099511628211ULL;}
        printf("sample portal=%u seq=%llu native-frame=%u native-buffer=%u generation=%llu role=%u surface=%u region=%d,%d,%d,%d bytes=%u diagnostic-fnv64=%016llx\n",
            r->portal,(unsigned long long)r->sequence,r->frame_id,r->buffer_id,(unsigned long long)r->buffer_generation,r->role_serial,r->surface_id,
            r->x,r->y,r->width,r->height,d->chunk->size,(unsigned long long)hash);fflush(stdout);
        pw_stream_queue_buffer(c->stream,b);
    }
}
static void stream_state(void *data, enum pw_stream_state old, enum pw_stream_state state, const char *error) {
    (void)old;
    if(state==PW_STREAM_STATE_ERROR || state==PW_STREAM_STATE_UNCONNECTED) {
        fprintf(stderr,"Native clean stream ended: %s\n",error?error:"disconnected");
        struct apparent_portal_client*c=data;c->failed=TRUE;g_main_loop_quit(c->main_loop);
    }
}
static const struct pw_stream_events events={PW_VERSION_STREAM_EVENTS,.state_changed=stream_state,.process=process};
static gboolean pipewire_ready(gint fd,GIOCondition condition,gpointer data) {
    (void)fd;
    struct apparent_portal_client*c=data;
    if(condition&(G_IO_HUP|G_IO_ERR) || pw_loop_iterate(c->pwloop,0)<0){c->source=0;c->failed=TRUE;g_main_loop_quit(c->main_loop);return G_SOURCE_REMOVE;}
    return G_SOURCE_CONTINUE;
}
struct apparent_portal_client *apparent_portal_client_start(int role_fd,GMainLoop *loop) {
    struct apparent_portal_client*c=g_new0(struct apparent_portal_client,1);c->main_loop=loop;
    c->bus=g_bus_get_sync(G_BUS_TYPE_SESSION,NULL,NULL);if(!c->bus)goto fail;
    char create[40],select[40],start[40],session_token[40];
    g_snprintf(create,sizeof(create),"r11_create_%u",g_random_int());g_snprintf(select,sizeof(select),"r11_select_%u",g_random_int());
    g_snprintf(start,sizeof(start),"r11_start_%u",g_random_int());g_snprintf(session_token,sizeof(session_token),"r11_session_%u",g_random_int());
    GVariantBuilder options;g_variant_builder_init(&options,G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&options,"{sv}","handle_token",g_variant_new_string(create));g_variant_builder_add(&options,"{sv}","session_handle_token",g_variant_new_string(session_token));
    GVariant *results=request(c,"CreateSession",g_variant_new("(a{sv})",&options),-1,create);if(!results)goto fail;
    if(!g_variant_lookup(results,"session_handle","s",&c->session)){g_variant_unref(results);goto fail;}g_variant_unref(results);
    c->closed=g_dbus_connection_signal_subscribe(c->bus,"org.freedesktop.portal.Desktop","org.freedesktop.portal.Session","Closed",c->session,NULL,G_DBUS_SIGNAL_FLAGS_NONE,session_closed,c,NULL);
    g_variant_builder_init(&options,G_VARIANT_TYPE_VARDICT);
    g_variant_builder_add(&options,"{sv}","handle_token",g_variant_new_string(select));
    g_variant_builder_add(&options,"{sv}","types",g_variant_new_uint32(1));
    g_variant_builder_add(&options,"{sv}","multiple",g_variant_new_boolean(FALSE));
    g_variant_builder_add(&options,"{sv}","cursor_mode",g_variant_new_uint32(1));
    g_variant_builder_add(&options,"{sv}","apparent_clean_role",g_variant_new_handle(0));
    results=request(c,"SelectSources",g_variant_new("(oa{sv})",c->session,&options),role_fd,select);if(!results)goto fail;
    gboolean acknowledged=FALSE;
    gboolean accepted=g_variant_lookup(results,"apparent_clean_role","b",&acknowledged)&&acknowledged;
    g_variant_unref(results);if(!accepted)goto fail;
    g_variant_builder_init(&options,G_VARIANT_TYPE_VARDICT);g_variant_builder_add(&options,"{sv}","handle_token",g_variant_new_string(start));
    results=request(c,"Start",g_variant_new("(osa{sv})",c->session,"",&options),-1,start);if(!results)goto fail;
    GVariant *streams=g_variant_lookup_value(results,"streams",G_VARIANT_TYPE("a(ua{sv})"));g_variant_unref(results);
    if(!streams || g_variant_n_children(streams)!=1){if(streams)g_variant_unref(streams);goto fail;}
    GVariant *stream=g_variant_get_child_value(streams,0);g_variant_unref(streams);
    uint32_t node;GVariant *properties;g_variant_get(stream,"(u@a{sv})",&node,&properties);g_variant_unref(stream);g_variant_unref(properties);
    g_variant_builder_init(&options,G_VARIANT_TYPE_VARDICT);
    GUnixFDList *fds=NULL;
    GVariant *reply=g_dbus_connection_call_with_unix_fd_list_sync(c->bus,"org.freedesktop.portal.Desktop","/org/freedesktop/portal/desktop","org.freedesktop.portal.ScreenCast","OpenPipeWireRemote",g_variant_new("(oa{sv})",c->session,&options),G_VARIANT_TYPE("(h)"),G_DBUS_CALL_FLAGS_NONE,30000,NULL,&fds,NULL,NULL);
    if(!reply)goto fail;
    int index;g_variant_get(reply,"(h)",&index);g_variant_unref(reply);
    int remote=fds?g_unix_fd_list_get(fds,index,NULL):-1;if(fds)g_object_unref(fds);if(remote<0)goto fail;
    pw_init(NULL,NULL);c->pwloop=pw_loop_new(NULL);if(!c->pwloop){close(remote);goto fail;}
    c->context=pw_context_new(c->pwloop,NULL,0);if(!c->context){close(remote);goto fail;}
    c->core=pw_context_connect_fd(c->context,remote,NULL,0);if(!c->core)goto fail;
    c->stream=pw_stream_new(c->core,"apparent-clean-native-proof",pw_properties_new(PW_KEY_MEDIA_TYPE,"Video",PW_KEY_MEDIA_CATEGORY,"Capture",PW_KEY_MEDIA_ROLE,"Screen",NULL));if(!c->stream)goto fail;
    pw_stream_add_listener(c->stream,&c->listener,&events,c);
    unsigned char storage[1024];struct spa_pod_builder builder=SPA_POD_BUILDER_INIT(storage,sizeof(storage));
    struct spa_video_info_raw info={.format=SPA_VIDEO_FORMAT_BGRx};
    const struct spa_pod *params[2];params[0]=spa_format_video_raw_build(&builder,SPA_PARAM_EnumFormat,&info);
    params[1]=spa_pod_builder_add_object(&builder,SPA_TYPE_OBJECT_ParamMeta,SPA_PARAM_Meta,SPA_PARAM_META_type,SPA_POD_Id(APPARENT_CLEAN_META_TYPE),SPA_PARAM_META_size,SPA_POD_Int(sizeof(struct apparent_clean_receipt_v1)));
    if(pw_stream_connect(c->stream,PW_DIRECTION_INPUT,node,PW_STREAM_FLAG_AUTOCONNECT|PW_STREAM_FLAG_MAP_BUFFERS,params,2)<0)goto fail;
    c->source=g_unix_fd_add(pw_loop_get_fd(c->pwloop),G_IO_IN|G_IO_HUP|G_IO_ERR,pipewire_ready,c);
    return c;
 fail:
    apparent_portal_client_stop(c);return NULL;
}
gboolean apparent_portal_client_ok(const struct apparent_portal_client*c) { return c && !c->failed && c->sequence>0; }
void apparent_portal_client_stop(struct apparent_portal_client*c) {
    if(!c)return;
    if(c->source)g_source_remove(c->source);
    if(c->stream)pw_stream_destroy(c->stream);
    if(c->core)pw_core_disconnect(c->core);
    if(c->context)pw_context_destroy(c->context);
    if(c->pwloop)pw_loop_destroy(c->pwloop);
    if(c->bus && c->session) {
        GVariant *reply=g_dbus_connection_call_sync(c->bus,"org.freedesktop.portal.Desktop",c->session,"org.freedesktop.portal.Session","Close",NULL,NULL,G_DBUS_CALL_FLAGS_NONE,3000,NULL,NULL);
        if(reply)g_variant_unref(reply);
    }
    if(c->closed)g_dbus_connection_signal_unsubscribe(c->bus,c->closed);
    if(c->bus)g_object_unref(c->bus);
    g_free(c->session);g_free(c);
}
