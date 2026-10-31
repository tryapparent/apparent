// Bounded production Peer::pin/liveness kernel test. No desktop or service.
#include "managers/screenshare/CleanPeer.hpp"
#include <sys/wait.h>
#include <cassert>
#include <cstdio>
#include <cstring>
int main() {
    int control[2]; assert(socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, control) == 0);
    pid_t child = fork(); assert(child >= 0);
    if (!child) {
        close(control[0]); int connection[2]; assert(socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, connection) == 0);
        char byte='x', ancillary[CMSG_SPACE(sizeof(connection))]{};
        iovec io{&byte,1}; msghdr msg{}; msg.msg_iov=&io; msg.msg_iovlen=1; msg.msg_control=ancillary; msg.msg_controllen=sizeof(ancillary);
        auto c=CMSG_FIRSTHDR(&msg);c->cmsg_level=SOL_SOCKET;c->cmsg_type=SCM_RIGHTS;c->cmsg_len=CMSG_LEN(sizeof(connection));memcpy(CMSG_DATA(c),connection,sizeof(connection));
        assert(sendmsg(control[1],&msg,0)==1);assert(read(control[1],&byte,1)==1);_exit(0);
    }
    close(control[1]);char byte, ancillary[CMSG_SPACE(sizeof(int)*2)]{};iovec io{&byte,1};msghdr msg{};msg.msg_iov=&io;msg.msg_iovlen=1;msg.msg_control=ancillary;msg.msg_controllen=sizeof(ancillary);
    assert(recvmsg(control[0],&msg,MSG_CMSG_CLOEXEC)==1);auto c=CMSG_FIRSTHDR(&msg);assert(c&&c->cmsg_level==SOL_SOCKET&&c->cmsg_type==SCM_RIGHTS);
    int connection[2];memcpy(connection,CMSG_DATA(c),sizeof(connection));
    auto display=wl_display_create();assert(display);auto client=wl_client_create(display,connection[0]);assert(client);
    auto peer=Apparent::Clean::Peer::pin(client);assert(peer&&peer->live());
    assert(write(control[0],"q",1)==1);int status;assert(waitpid(child,&status,0)==child&&WIFEXITED(status)&&WEXITSTATUS(status)==0);
    assert(!peer->live());
    // Both socket endpoints remain open in this parent: connection liveness
    // must not substitute for the socket-opening process instance's pidfd.
    assert(fcntl(connection[1],F_GETFD)>=0);
    wl_client_destroy(client);wl_display_destroy(display);close(connection[1]);close(control[0]);
    puts("PASS production SO_PEERPIDFD pin: peer death denies inherited still-open native connection. No cached numeric PID authority. Not compositor/portal acceptance.");
}
