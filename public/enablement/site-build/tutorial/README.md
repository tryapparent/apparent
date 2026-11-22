# Apparent tutorial authoring

The five-scene tutorial from `public/site/video-demo` is rendered with
Chromium and encoded with FFmpeg. The original SVG layout, motion, fonts,
images and soundtrack are the reference. It shows the historical shortcut,
target picker, drawing, bundle and paste flow from the original tutorial.
Chromium handles SVG, text shaping and image compositing. The source soundtrack
is silent PCM. The encoder retains the original −2 dB gain, 250 ms fade-in
and 800 ms fade-out settings for soundtrack editing.
The original scene clock yields 1,439 frames at 60 fps, with 18-frame overlaps.
That frame count includes the fframes 1.2 single-precision truncation of the
nominal 4.2-second paste scene to 251 frames.

Use Node 22, the locked Public dependencies, Playwright Chromium and FFmpeg with
`libx264` and AAC. From `public/site` on Linux or macOS:

```sh
bun install --cwd .. --frozen-lockfile
../node_modules/.bin/playwright-core install chromium
job=$(mktemp -d /tmp/apparent-dev-tutorial-XXXXXX)
npm run generate:tutorial -- frame "$job/intro.png" 105
npm run generate:tutorial -- movie "$job/tutorial.mp4"
npm run test:tutorial
```

Frame indices are zero-based. Each movie is 1920×1080 H.264 with AAC audio.
Choose a fresh output path in an existing private directory with space for the
intermediate PNGs. The command publishes a completed output atomically and
rejects an existing destination. Set `CHROME_PATH` to use an installed Chromium.
Public CI decodes the generated movie and checks the scene sequence
and soundtrack against the authoring inputs.

The three site movie paths have separate provenance:

| Asset | Provenance |
| --- | --- |
| `Apparent-ghost-demo-v4-lilac.mp4` and poster | The approved recording from PR #148. The site packages the checked-in export and Pages serves it through the prepared-movie worker. |
| `apparent-demo-pi.mp4` and poster | The archived browser capture described in the [Pi cut notes](../../../site/docs/apparent-demo-pi.md). |
| `og.mp4` | The silent loop from [the Open Graph renderer](../../og-video/capture.mjs) and `npm run generate:og-video`. |

Tutorial artifacts are for authoring and inspection. The Pages allowlist still
sources the approved ghost movie and poster from `site/public/assets/media`.
