# Public brand book

Recovered from `gitlab.com/tryapparent/apparent`, revision
`eae09dad2030f15dd8f681fc2ab067d779f66c70`, `public/brand` and its three shared
presentation helpers. The existing reading view, slides, artwork, licenses and
agent-readable standards are preserved. Runtime modules use TypeScript paths.

The Public build compiles this page into `dist/brand/index.html`; the normal
public asset plugin supplies its approved files from `public/assets/brand-book`.
The Public packager, validation and production publisher include this route.
No GitLab checkout, old server, submodule or separate deployment is required.
`/brand/` opens the reading view; `?slides=1#slide-N` opens the presentation.

The recovered book's palette is the latest donor's palette, including Carbon
`#020102` and Signal `#7A58C7`. Restoring it does not change Desktop or Shared
tokens. The portal templates are downloadable implementation source examples,
not an authenticated application or executable Public routes.

The capture-brand revision keeps the logo, palette and typeface and replaces the
old document-product positioning in the reader, presentation and agent-readable
files. `assets/frogs/collection.json` indexes original site poses and the two
Connect illustrations published beside it. The reader reuses `/pond/` images;
it does not duplicate those masters. New poses should use an original reference
and remain candidates until reviewed.

`component-library.tsx` renders the actual `@apparent/ui` React sources. The
book applies a scoped fixed-palette specimen theme in `brand-kit.css`; it does
not change Desktop or Connect themes. The file dependency is resolved with
preserved symlinks so Bun's linked source files use the Public dependency graph.
Gallery state exists only in memory. Historical portal/Svelte material and old
campaign images remain downloadable legacy references, not current templates.
The browser route test exercises assets, keyboard tabs, validation and status
recovery at 1440, 390 and 320px. Rollback is a normal Public source revert; no
route cutover, config migration or external asset storage is involved.
