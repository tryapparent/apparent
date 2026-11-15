# apparent identifier standard

Status: approved 21.07.2026

Use prefixed ULIDs as the single canonical identifier format for durable
product objects.

## Format

`<prefix>_<ULID>`

Example: `run_01JQ7M6J8H9T2R4K5N6P7Q8S9T`

- Prefixes are lowercase ASCII and identify the object type.
- The separator is one underscore.
- The ULID is the canonical 26-character uppercase Crockford Base32 form.
- Store the ULID as 128-bit binary where the data store supports it. APIs and
  user interfaces expose the complete prefixed string.

## Approved prefixes

| Prefix | Object |
| --- | --- |
| `doc_` | Source document |
| `run_` | Processing attempt |
| `bat_` | Submitted batch |
| `rev_` | Durable review decision |
| `out_` | Structured output |

New prefixes require a named object, an owner, a collision check, and approval
in this file before use.

## Behavior

- Generate the identifier once. It is immutable and never recycled.
- Retrying the same request must not create a second object. Use an idempotency
  key at the write boundary.
- Reprocessing a document creates a new `run_` and preserves the relationship
  to the existing `doc_`.
- Treat the value as opaque. Do not parse the type or timestamp for permissions,
  retention, routing, or other business logic.
- An identifier is not a secret, capability, or authorization token. Enforce
  access control independently.
- Never include customer names, filenames, email addresses, dates, tenant
  names, document content, or other personal information.

## Interface presentation

- Detail screens and copy actions expose the full ID.
- Dense tables may shorten the middle visually. The accessible name, title, and
  copied value must preserve the complete ID.
- Use a monospace face only for the value. Keep the explanatory label in Host
  Grotesk.
- Search accepts the full ID. Prefix-only search must not expose unauthorized
  objects.

## Rejected alternatives

- Sequential integers are compact but predictable and reveal rough volume.
- Bare UUIDs lack type context when copied between systems.
- Hex hashes are useful for content integrity, not as the default object ID.
- Human word combinations are memorable but are labels, not reliable unique
  identifiers.

## Technical basis

- [IETF RFC 9562](https://www.ietf.org/rfc/rfc9562.html)
- [ULID specification](https://github.com/ulid/spec)
