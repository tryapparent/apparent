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
