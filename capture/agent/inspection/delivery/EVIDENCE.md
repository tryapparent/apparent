# Retained Linux evidence

Candidate source: `199f281c4707351a1d8e85b08fcedf2c2b1a05fa`, tree
`0a4cb9428d7c92ac4c3aa99155c20f2b916c1938`. Subsequent integration must
assess relevant inputs; these are concrete prior runs, not unrun final-head claims.

- Root build and compiler closure sealed successfully; cached wall time 4419 ms.
- Root suite: 917 passed, 14 ignored; `/tmp/inspection-integrated-root-tests.log`.
- Standalone archive build/test/install/installed golden/default/configured lookup:
  `target/inspection-1793825520538/proof/proof.json`, status passed.
- Real root dispatch compared two inspector archives in ten cases. Cargo was
  replaced with a failing trap during assembly. Both retained root SHA-256
  `a9210ece1a1a06287fb3abdf9b7b3019ff596025954eee8bf7d3a2b543e52fb4`; rootRebuilt=false.
  `/tmp/integrated-real-composition.log`.
- Actual AppImage outside-checkout proof: ten golden/lookup/error cases, manifest
  hash/mtime preservation and component tamper rejection;
  `/tmp/inspection-integrated-image-proof/proof.json`.
- Actual root-owned AppImage ran inspection as UID 65534 with an isolated
  per-user TMPDIR; `/tmp/inspection-runtime-user-r3.log`. Earlier attempts hit
  AppImage's shared extraction cache permissions and remain in r1/r2 logs.
- Final AppImage SHA-256:
  `66db67f44fb99cb105f8c8b1cf2c294bcb9a58d1e546e50cc49ba1c9a30f97b3`.
  Builder encoder check produced and decoded H.264;
  `/tmp/inspection-integrated-appimage-r2.log`. First attempt failed native
  library discovery after moving the host; fixed using admitted input directory.
- Exact-source Mac artifact admission: 86 tests passed. Preview release/signing
  contracts: 16 passed. These are offline contracts, not Mac execution.
- Shared transaction/component tests: three passed; real installer-script tests:
  five passed, including repeat, pin upgrade, failed admission retention and lock
  release. Genuine recipient status ran as UID 65534 from a root-owned 0755
  component. Synthetic provenance transport is explicitly not official provenance.

Mac gates remain unverified; see ACCEPTANCE.md for exact commands and missing
approved resource. Final independent review, merge and exact-main publication
verification remain outstanding. No paid resource or CI dispatch was requested.

Build context retained for the next root-build slice: cold root test compilation
was 3m06s; cached adoption builds were 5.83s and 4.42s. Standalone component builds
exclude Desktop/GPUI/capture; whole-root cold native work is still substantial.
These differing cache states do not support a speedup benchmark.

## Current-main integrated rerun

Source `341bb83a66da128f7fae31bbb107f2ce2f44fe7d` includes main
`1ad6a64a2e84` and the narrow current recipient admission contract. Its actual
AppImage passed the same ten cases and tamper rejection:
`/tmp/inspection-final-image-proof/proof.json`. Builder H.264 encode/decode passed;
`/tmp/inspection-final-appimage.log`. Final AppImage SHA-256:
`437b671df9babea866ef797f631a063926efc7cbb6c6fc37f85d9748f1d44b12`.
The final source archive producer again passed build/test/install/golden/lookup
checks in `target/inspection-1793825970727/proof/proof.json`.

Two-component composition again passed with Cargo forbidden, rootRebuilt=false
and unchanged root SHA-256
`fd389ed4a32e12660435d456a5f2b1e4a78e7eb4dd4e9be577ffb15193b13b29`;
`/tmp/inspection-final-composition.log`. Root sealing took 4334 ms with warm
caches. Current-main owner-input CI selection contracts passed all 16 tests.
The root Rust source/build dependencies are unchanged from the 917-test run;
incoming main changes affected CI/web selection and native-test diagnostics.
Final changes after this rerun are evidence documentation only, excluded by the
pinned root-input policy. No unrun final-head native proof is implied.

The proposed capture-control follow-up must preserve more than DTOs:
Desktop imports Action plus clock_ms/same_user/socket_path/valid_id/connect_until/
DeadlineStream from the existing client; root CLI alone imports execute/new_id.
First isolate the provider-required wire and socket/deadline safety mechanisms
from the executable's transport/argument implementation, then adopt the packaged
client at the root dispatch and audit actual compiler dep-info exclusions. A CLI
forwarder alone would leave the full client crate in the root closure. No follow-up
implementation is included here.
