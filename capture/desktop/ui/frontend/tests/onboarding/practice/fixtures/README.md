# Old producer evidence

`corpus.json` is the byte-identical old Rust Session/Flow/Practice/config-writer
output from base 327aefdeea3fe7f9c7771c649094b20f81c5f4fb, test-only generator
commit d368824c591e3f7c0c5887e9ba19eb0bca4d4486. SHA256:
376946247ee36fd352570a128c28ed48d7f734e83ff6e076e08e59bb788cab44.
`provenance.json` preserves source/output hashes and `generator.json` the byte-exact base64-encoded patch and its SHA256 for the exact
source-generation recipe. Apply the recipe only to that historical source in an
isolated test checkout; its imports intentionally reference the removed donor.
It is evidence, never a production module or an alternative policy implementation.

The cold Node corpus test feeds only native admission facts to the production
PracticeHost; old lesson stages/projections are assertions only. The native
`real_native_adapter_matches_old_producer_policy_queries` test drives the new
actual Session adapter through all 212 calls against the same old outputs.
The compatibility corpus is synthetic and supplies no OS/provider acceptance.

Decode the `patch` field with `Buffer.from(value.patch, "base64")` before applying
the historical generation recipe. This preserves format-patch whitespace and all
original bytes; compare its SHA256 with the manifest before use.
