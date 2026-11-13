# Engine SDK

`@apparent/engine-sdk` provides `probeMovie({executable, movie, timeoutMs?, signal?})`.
Both paths must be absolute. Provision the matching native artifact explicitly;
the SDK does not search for Engine, compile, install or download anything.

The result contains container duration, the first video track's dimensions/rate
and timing, and every audio track's original stream index and timing. Missing
facts are `null`. Mac additionally supplies actual nonempty audio edit segments;
Linux reports segment detail unavailable. Audio selection, overlap decisions,
export and workflow policy stay with the consumer.

The deadline defaults to 30 seconds (maximum 60). Cancellation and deadline
failure wait for the launched reader to exit; they do not return a partial
result. Native diagnostics and private paths are not included in SDK errors.
Source policy tests/typechecking require only Node 22.18+ and the locked compiler.
See `engine/README.md` for the complete package check and native prerequisites.
