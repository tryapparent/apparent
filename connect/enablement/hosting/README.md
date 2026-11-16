# Hosted publication recovery

The publisher verifies an immutable tested artifact, bindings, runtime, provider
settings and deployment ownership before activating traffic. Empty version-binding
metadata is reread at most six times, with 31 seconds of total backoff. Nonempty
configuration drift, wrong identity/runtime and provider errors fail immediately.

One recovery tuple permits superseding the unactivated version from failed run
`43699705723`: stage `51864fbb-02d1-494a-8302-7c581281640b`, tag
`d81e8eed8a5dfa818cefbbbc32896b5c10d96478`, with live baseline
`4bc3e3e5-4ab9-4e9c-b2c6-53b8c07fd183` still active. Its full bindings and runtime
must match that baseline. Recovery uploads the current tested artifact; it never
activates or deletes the old stage. Unknown stages still require investigation.
Once a new version is active this exception cannot apply; remove the tuple after
verified publication. All ordinary main admission and publication guards remain.
