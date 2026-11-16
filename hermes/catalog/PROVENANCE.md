# Immutable catalogue payload

- Product source: https://github.com/tryapparent/apparent/commit/e7b8245f5cbd3ad6c76cdb49f3c898a761035c4a
- Successful exact-source verification and publication: https://github.com/tryapparent/apparent/actions/runs/43827589177
- Published package: https://github.com/tryapparent/apparent/releases/tag/hermes-v0.4.0-e7b8245f5cbd3ad6c76cdb49f3c898a761035c4a
- Archive SHA-256: `77ffd5b66ec157678f3b246b4aa2df235eab5d6d26dc281f65c1dd6ae4b7f0b2`
- Desktop entry SHA-256: `1fa8d0f2e4752bae4684eaaccc8e863739ce71c541491f3ae8a37f9c14a5c5d2`

The runtime files are copied byte-for-byte from that archive: `__init__.py`,
`adapter.py`, `process.py`, `evidence.py`, `plugin.yaml`, `desktop/plugin.js`,
`skills/recordings/SKILL.md` and `compatibility.json`. Catalogue-specific README,
provenance and the repository license are included; `package-files.json` inventories
this complete payload. There is no binary, downloader, eval, runtime compilation,
extra dependency or code change in the catalogue payload.

## Reproduce

At the product source commit above, install the locked build dependency with
`npm ci --ignore-scripts --prefix hermes/desktop`, then run:

```sh
JOB=$(mktemp -d /tmp/apparent-dev-catalog-reproduce-XXXXXX)
HERMES_REVISION=e7b8245f5cbd3ad6c76cdb49f3c898a761035c4a \
  node --experimental-strip-types hermes/desktop/package.ts "$JOB/release"
```

Compare unpacked runtime file hashes with this directory, rather than the archive
hash: tar/gzip metadata can differ. `compatibility.json` records the product source
revision; the upstream catalogue separately pins the exact distribution commit.

## Future updates

Regenerate from a tested, published product commit and verify the runtime hashes.
Publish a new immutable distribution commit, then submit a new SHA-bump PR to the
Hermes catalogue for maintainer review. Never move the installed pin automatically
or download replacement plugin code at runtime. Keep generated catalogue payloads
on the distribution branch, off development Main. Do not use this release branch
as a product-development base.
