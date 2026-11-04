Connect producer prerequisite

connect-delivery.yml builds and verifies browser and Worker outputs on main push
or manual main dispatch, without native CI. It uploads separate immutable Actions
artifacts named connect-browser-<full SHA> and connect-worker-<full SHA>, each
containing manifest.json and dist/. The reusable publisher accepts required string
input `producer-run`; an empty input selects the producer, a nonempty input selects
publication. Public invokes it independently with `secrets: inherit`.

Run `node --experimental-strip-types connect/delivery/artifacts.ts seal DIR KIND`
then `validate DIR KIND` from a clean committed checkout. KIND is connect-browser
or connect-worker. The manifest records source identity, input and output hashes,
production environment and runtime versions. This is local integrity evidence,
not independent trusted GitHub-run admission; Public owns that integration.

Producer analytics covers shared configuration, production artifacts and synthetic
Connect consent behavior. Public owns composed analytics transport acceptance.
Five browser assets still come from Public. Existing
Python theme checks and native Connect client/consumer coupling remain; this
producer is not complete Connect language or delivery independence.

Worker publisher transition

The publish job in connect-delivery.yml consumes authenticated canonical producer metadata and verifies
its GitHub archive SHA256 before extracting exactly manifest.json and dist/worker.js.
The artifacts CLI validates complete candidate inventory, output hashes and source
ancestry against current main. Wrangler receives the verified payload with
--no-bundle; no product build runs in the publisher.

Publication retains HOSTED_CD_ENABLED, hosted-production bindings and the common
web-delivery-production-eligible lock. The retirement check deliberately
fails while web-delivery.yml still declares its hosted job. Public must remove that
job atomically with adoption; this is an existing-publisher retirement contract.
Browser composition remains Public-owned. Native consumers still couple to Connect;
this Worker publisher does not establish whole-product independence.

runtime/ contains byte-identical transitional copies of hosted_config.py and
verify_worker.py. PYTHONPATH supplies the existing enablement/release_gate import;
the originals remain untouched. Remove donors only with Public's coordinated
consumer migration; move release_gate ancestry policy only as a separately verified
compatible owner change. Runtime controls, resources and migrations are unchanged.

Outstanding independence gate: main pushes still build unchanged Connect inputs.
Trusted artifact reuse/selection and an explicit selected-run/not-applicable result
contract with Public are not implemented; callers currently require a real
successful producer run containing the requested Worker artifact. Manual dispatch
continues to force a fresh producer run.
