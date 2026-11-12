# Homepage belief statement

The accepted homepage displays the original belief wording and its hand-drawn
marks above the two photo cutouts. `src/components/home/PhotoStory.tsx` owns this
markup; the former hidden frog scene is not a visible production workflow.

Build and package from TypeScript/React source, verify desktop/mobile appearance
and interactions, and publish through main-branch Pages CD (`pages-deploy.md`).
The compiled-bundle overlay packager is retired. The superseded interactive frog scene and its obsolete tests are retired.

The hero offers a secondary agent setup prompt beside the direct download (wrapping on phones).
Its read-only field shows “Install apparent…” and selects the complete prompt on
focus; Copy writes the full value and reports clipboard success or failure.
The prompt covers app installation and launch, enabling both Hermes plugin halves,
and helping the user rescan/reload Desktop plugins. It leaves onboarding to the app's normal
launch behavior instead of asking an agent to find or restart the tour in Settings.

The Mac download action resolves the latest published Apple silicon DMG on click,
including Safari and other browsers that cannot identify the chip. Its label
discloses Apple silicon; known Intel Macs remain unsupported. Release lookup
failures and modified clicks retain the GitHub Releases fallback.

Linux also downloads its latest published AppImage on activation. Detected
ARM64 browsers get ARM64; unknown CPUs default to the explicitly labeled x86_64
download. Release lookup failures retain the same Releases fallback.
