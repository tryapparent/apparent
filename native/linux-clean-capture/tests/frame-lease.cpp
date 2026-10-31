// MODEL ONLY: production lease policy using synthetic identities, not pixels.
#include "managers/screenshare/CleanLease.hpp"
#include <cassert>
#include <cstdio>
using namespace Apparent::Clean;
int main(){
    CapabilityRegistry registry;
    auto role=registry.mintInternal();int exported=role->exportFD();assert(exported>=0);assert(registry.importFD(exported)==role);
    int forged[2];assert(pipe(forged)==0);assert(!registry.importFD(forged[0]));close(forged[0]);close(forged[1]);
    auto a=std::make_shared<PortalLifetime>(10),b=std::make_shared<PortalLifetime>(11);
    Receipt ia{10,1,70,1,100,200},ib{11,1,70,1,101,201};
    FrameLease first(a,role,ia),interleaved(b,role,ib);
    assert(first.live(70,100,200,1));assert(interleaved.live(70,101,201,1));
    assert(!first.live(70,101,201,1));assert(!first.live(71,100,200,1));assert(!first.live(70,100,200,2));
    assert(first.complete(70,100,200,1));assert(!first.complete(70,100,200,1));
    FrameLease replay(a,role,ia);assert(!replay.live(70,100,200,1));
    a->revoke();assert(interleaved.live(70,101,201,1));assert(interleaved.complete(70,101,201,1));
    Receipt later{11,2,70,2,102,202};FrameLease pending(b,role,later);assert(pending.live(70,102,202,2));
    role->revoke();assert(!registry.importFD(exported));assert(!pending.complete(70,102,202,2));close(exported);
    auto role2=registry.mintInternal();Receipt third{11,3,70,3,103,203};FrameLease async(b,role2,third);b->revoke();assert(!async.complete(70,103,203,3));
    puts("PASS MODEL ONLY: independent same-source portal leases, exact frame/buffer/source/generation, replay/duplicate terminal, role replacement and async portal revocation. No native stream/pixels.");
}
