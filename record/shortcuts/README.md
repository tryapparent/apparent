# Record shortcut

`policy.ts` defines the platform default and the precedence of a verified
desktop-managed shortcut over an ordinary saved shortcut. A valid explicit
Apparent choice retains precedence on Linux.

Cargo uses Node 22 to compile this policy into the native app at build time.
The native adapter resolves the keyboard-layout code on Linux, verifies
compositor bindings, and keeps sole responsibility for registration and config
transactions. Settings and onboarding use the native effective label,
managed state and Mac Fn suggestion over their existing bridges. Reset and
startup resolve the default through the same native adapter. The standalone
legacy Electron onboarding launch still accepts old presenter snapshots
without a suggestion field and uses the existing physical Mac Fn mapping.

Run the owner tests with
`node --experimental-strip-types --test record/enablement/shortcuts/policy.test.ts`.
The desktop integration checks exercise both Electron editors. Native delivery
still needs a real shortcut registration, start, finish and relaunch on each
platform. Roll back the producer and both renderer consumers together. The
on-disk format and transaction writer are shared by both revisions.
