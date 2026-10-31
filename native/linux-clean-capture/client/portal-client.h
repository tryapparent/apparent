#pragma once
#include <glib.h>
struct apparent_portal_client;
struct apparent_portal_client *apparent_portal_client_start(int role_fd, GMainLoop *loop);
void apparent_portal_client_stop(struct apparent_portal_client *client);
gboolean apparent_portal_client_ok(const struct apparent_portal_client *client);
